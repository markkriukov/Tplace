import asyncio
import os
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace
from unittest.mock import patch

from database_fixture import requires_database
import worker
from services import gift_deposits as deposits
import create_session


class SessionConfigurationTests(unittest.TestCase):
    def test_session_uses_environment_credentials_and_rejects_missing_settings(self):
        environment = {'TELEGRAM_API_ID': '111111', 'TELEGRAM_API_HASH': 'a' * 32}
        with patch.dict(os.environ, environment, clear=True), \
                patch.object(create_session.asyncio, 'run', side_effect=lambda coroutine: coroutine.close()) as run, \
                patch('builtins.print'):
            create_session.main()
            run.assert_called_once()
            self.assertEqual(dict(os.environ), environment)
        for environment in [{}, {'TELEGRAM_API_ID': '-1', 'TELEGRAM_API_HASH': 'a' * 32},
                            {'TELEGRAM_API_ID': '111111', 'TELEGRAM_API_HASH': ' '},
                            {'API_ID': '222222', 'API_HASH': 'b' * 32}]:
            with self.subTest(environment=list(environment)), \
                    patch.dict(os.environ, environment, clear=True), \
                    patch.object(create_session.asyncio, 'run') as run, patch('builtins.print'):
                with self.assertRaises(ValueError):
                    create_session.main()
                run.assert_not_called()


class RenamedSettingsTests(unittest.TestCase):
    def test_worker_refuses_to_start_with_a_renamed_setting(self):
        with patch.dict(os.environ, {'GIFT_SYNC_INTERVAL': '60'}), patch.object(worker.asyncio, 'run') as run:
            with self.assertRaisesRegex(SystemExit, 'GIFT_SYNC_INTERVAL was renamed to CUSTODY_RECONCILE_INTERVAL_SECONDS'):
                worker.main()
            run.assert_not_called()


class WorkerRecoveryTests(unittest.IsolatedAsyncioTestCase):
    async def test_incomplete_scan_times_out_releases_lock_and_never_publishes_absence(self):
        async def stalled_scan(*_args, **_kwargs):
            yield SimpleNamespace(id=1)
            await asyncio.Event().wait()

        client = SimpleNamespace(me=SimpleNamespace(id=123), get_chat_gifts=stalled_scan)
        listener = deposits.GiftDeposits(client)
        with patch.object(deposits, 'GIFT_CUSTODY_SCAN_TIMEOUT_SECONDS', 0.02), \
                patch.object(deposits, 'complete_inventory') as complete:
            with self.assertRaises(TimeoutError):
                await listener.reconcile()
        self.assertFalse(listener.lock.locked())
        complete.assert_not_called()

    async def test_message_read_uses_the_same_scan_deadline(self):
        async def scan(*_args, **_kwargs):
            yield SimpleNamespace(id=1, received_gift_id='7')

        async def stalled_message(*_args):
            await asyncio.Event().wait()

        listener = deposits.GiftDeposits(SimpleNamespace(me=SimpleNamespace(id=123),
            get_chat_gifts=scan, get_messages=stalled_message))
        with patch.object(deposits, 'GIFT_CUSTODY_SCAN_TIMEOUT_SECONDS', 0.02), \
                patch.object(deposits, 'is_regular_gift', return_value=False), \
                patch.object(deposits, 'processed_messages', return_value=set()), \
                patch.object(deposits, 'complete_inventory') as complete:
            with self.assertRaises(TimeoutError):
                await listener.reconcile()
        complete.assert_not_called()
        self.assertFalse(listener.lock.locked())


@requires_database
class UserUpsertTests(unittest.TestCase):
    def test_parallel_first_login_and_deposit_share_one_user_and_preserve_admin(self):
        from db import SessionLocal, User
        from repositories.gifts import upsert_user
        from sqlalchemy import select, text
        identifier = time.time_ns() // 1000

        def create(index):
            with SessionLocal.begin() as session:
                if index % 2:
                    return session.scalar(text('''INSERT INTO users(telegram_id,username,first_name,is_admin)
                        VALUES (:id,'login','Login',true) ON CONFLICT(telegram_id) DO UPDATE
                        SET username=EXCLUDED.username,is_admin=true RETURNING pk_user_id'''), {'id': identifier})
                user = upsert_user(session, SimpleNamespace(id=identifier, username='deposit', first_name='Deposit'))
                return user.pk_user_id

        with ThreadPoolExecutor(max_workers=6) as pool:
            identifiers = list(pool.map(create, range(12)))
        self.assertEqual(len(set(identifiers)), 1)
        with SessionLocal.begin() as session:
            current = session.scalar(select(User).where(User.telegram_id == identifier))
            self.assertTrue(current.is_admin)
            updated = upsert_user(session, SimpleNamespace(id=identifier, username='updated', first_name='Updated'))
            self.assertIs(updated, current)
            self.assertEqual(updated.username, 'updated')
            self.assertTrue(updated.is_admin)
