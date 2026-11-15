import asyncio
import time
import threading
import unittest
import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from database_fixture import requires_database
from catalog_fixture import seed_catalog


def gift_fixture(identifier):
    return SimpleNamespace(
        id=identifier, name=f'Import{identifier}-1', type='UPGRADED', regular_gift_id=identifier + 200,
        model=SimpleNamespace(name='Imported model', rarity=15),
        symbol=SimpleNamespace(name=f'Imported symbol {identifier}', rarity=20),
        backdrop=SimpleNamespace(id=identifier + 100, name=f'Imported backdrop {identifier}', rarity=25),
    )


class ImportFetchTests(unittest.TestCase):
    def test_kurigram_receives_limit_and_nft_filters_and_iterator_is_bounded(self):
        from services import gift_import
        calls = []
        class Client:
            async def get_users(self, username):
                self.username = username
                return SimpleNamespace(id=42)

            async def get_chat_gifts(self, chat_id, **options):
                calls.append((chat_id, options))
                for identifier in range(10):
                    yield SimpleNamespace(id=identifier)

        user, gifts = asyncio.run(gift_import.fetch_import_gifts('example', 2, Client()))
        self.assertEqual(user.id, 42)
        self.assertEqual(len(gifts), 2)
        self.assertEqual(calls, [(42, {'limit': 2, 'exclude_unlimited': True, 'exclude_upgradable': True, 'exclude_non_upgradable': True})])


class ImportResponsivenessTests(unittest.IsolatedAsyncioTestCase):
    async def test_database_waits_leave_the_telegram_event_loop_responsive(self):
        from services import gift_import
        job = {'pk_gift_import_id': 1, 'fk_admin_user_id': 2, 'username': 'source', 'max_count': 1}
        for phase in ('claim_import', 'check_import_admin', 'save_import', 'fail_import'):
            with self.subTest(phase=phase):
                entered = asyncio.Event()
                release = threading.Event()
                loop = asyncio.get_running_loop()

                def database_wait(*args):
                    loop.call_soon_threadsafe(entered.set)
                    if not release.wait(5):
                        raise TimeoutError('The event loop could not release the database wait')
                    return job if phase == 'claim_import' else None

                fetch = AsyncMock(side_effect=TimeoutError()) if phase == 'fail_import' else AsyncMock(return_value=(SimpleNamespace(), []))
                with patch.object(gift_import, 'claim_import', return_value=job), \
                     patch.object(gift_import, 'check_import_admin'), \
                     patch.object(gift_import, 'save_import'), \
                     patch.object(gift_import, 'fail_import'), \
                     patch.object(gift_import, 'fetch_import_gifts', fetch), \
                     patch.object(gift_import, phase, side_effect=database_wait):
                    task = asyncio.create_task(gift_import.process_next_import_async(SimpleNamespace()))
                    try:
                        await asyncio.wait_for(entered.wait(), 2)
                        self.assertFalse(task.done(), 'Database work blocked other Telegram tasks')
                    finally:
                        release.set()
                        await asyncio.wait_for(task, 3)


@requires_database
class ImportJobTests(unittest.TestCase):
    def setUp(self):
        from services import gift_import
        from db import SessionLocal, User, init_database
        init_database()
        self.importer = gift_import
        self.identifier = time.time_ns() // 1000
        self.source = SimpleNamespace(id=self.identifier + 1, username='sourceuser', first_name='Source')
        self.gift = gift_fixture(self.identifier + 2)
        seed_catalog(self.gift)
        with SessionLocal.begin() as session:
            admin = User(telegram_id=self.identifier, username=f'admin_{self.identifier}', is_admin=True)
            session.add(admin)
            session.flush()
            self.admin = admin.pk_user_id

    def queue(self, status='queued'):
        from db import SessionLocal
        from sqlalchemy import text
        with SessionLocal.begin() as session:
            return session.scalar(text('''INSERT INTO admin_gift_imports(fk_admin_user_id, username, max_count, request_key, status)
                VALUES (:admin, 'sourceuser', 2, :key, :status) RETURNING pk_gift_import_id'''),
                {'admin': self.admin, 'key': str(uuid.uuid4()), 'status': status})

    def job(self, identifier):
        from db import SessionLocal
        from sqlalchemy import text
        with SessionLocal() as session:
            return session.execute(text('SELECT * FROM admin_gift_imports WHERE pk_gift_import_id=:id'), {'id': identifier}).mappings().one()

    def run_job(self, gifts=None, error=None):
        fetch = AsyncMock(side_effect=error) if error else AsyncMock(return_value=(self.source, gifts or [self.gift]))
        with patch.object(self.importer, 'fetch_import_gifts', fetch):
            asyncio.run(self.importer.process_next_import_async(SimpleNamespace()))
        return fetch

    def test_import_targets_admin_and_repetition_preserves_owner_and_custody(self):
        from db import SessionLocal, Gift, Ownership
        from sqlalchemy import select, text
        first = self.queue()
        self.run_job()
        self.assertEqual(self.job(first)['result']['added'], 1)
        with SessionLocal() as session:
            gift_id = session.scalar(select(Gift.pk_gift_id).where(Gift.telegram_gift_id == self.gift.id))
            self.assertTrue(session.scalar(select(Gift.is_test_import).where(Gift.pk_gift_id == gift_id)))
            self.assertEqual(session.scalar(select(Ownership.fk_user_id).where(Ownership.fk_gift_id == gift_id)), self.admin)
            self.assertEqual(session.scalar(text('SELECT count(*) FROM gift_custody_observations WHERE fk_gift_id=:gift'), {'gift': gift_id}), 0)
            self.assertEqual(session.scalar(text('SELECT count(*) FROM gift_custody_snapshots WHERE fk_user_id=:admin'), {'admin': self.admin}), 0)
        # Existing gifts, including ones owned by someone else, are skipped.
        with SessionLocal.begin() as session:
            from db import User
            other = User(telegram_id=self.identifier + 500, username='other_import_owner')
            session.add(other)
            session.flush()
            other_id = other.pk_user_id
            session.execute(text('UPDATE ownerships SET fk_user_id=:other WHERE fk_gift_id=:gift'), {'other': other_id, 'gift': gift_id})
        second = self.queue()
        self.run_job()
        self.assertEqual(self.job(second)['result']['added'], 0)
        self.assertEqual(self.job(second)['result']['skipped'], 1)
        self.assertEqual(self.job(second)['result']['missing_catalog'], 0)
        with SessionLocal() as session:
            self.assertEqual(session.scalar(select(Ownership.fk_user_id).where(Ownership.fk_gift_id == gift_id)), other_id)

    def test_gifts_missing_from_catalog_are_skipped_and_counted(self):
        from db import SessionLocal, Gift
        from sqlalchemy import select, func
        unknown = gift_fixture(self.identifier + 3)  # Its collection is not in the catalog.
        job = self.queue()
        self.run_job([self.gift, unknown])
        result = self.job(job)['result']
        self.assertEqual((result['added'], result['skipped'], result['missing_catalog']), (1, 1, 1))
        with SessionLocal() as session:
            self.assertEqual(session.scalar(select(func.count()).select_from(Gift).where(Gift.telegram_gift_id == unknown.id)), 0)

    def test_fetch_failure_and_save_failure_leave_no_partial_inventory(self):
        from services import gift_persistence
        from db import SessionLocal, Gift
        from sqlalchemy import select, func
        first = self.queue()
        self.run_job(error=TimeoutError())
        self.assertEqual(self.job(first)['error_code'], 'IMPORT_TIMEOUT')
        second = self.queue()
        original = gift_persistence.save_gifts_and_ownerships
        def fail_after_write(*args, **kwargs):
            original(*args, **kwargs)
            raise RuntimeError('Injected failure')
        with patch.object(gift_persistence, 'save_gifts_and_ownerships', side_effect=fail_after_write):
            self.run_job()
        self.assertEqual(self.job(second)['status'], 'failed')
        with SessionLocal() as session:
            self.assertEqual(session.scalar(select(func.count()).select_from(Gift).where(Gift.telegram_gift_id == self.gift.id)), 0)

    def test_revoked_admin_is_rejected_before_telegram_access(self):
        from db import SessionLocal
        from sqlalchemy import text
        job = self.queue()
        with SessionLocal.begin() as session:
            session.execute(text('UPDATE users SET is_admin=false WHERE pk_user_id=:id'), {'id': self.admin})
        fetch = self.run_job()
        fetch.assert_not_awaited()
        self.assertEqual(self.job(job)['error_code'], 'ADMIN_REQUIRED')

    def test_interrupted_job_is_failed_on_worker_restart(self):
        job = self.queue(status='running')
        fetch = self.run_job()
        fetch.assert_not_awaited()
        self.assertEqual(self.job(job)['error_code'], 'WORKER_RESTARTED')

    def tearDown(self):
        from db import SessionLocal
        from sqlalchemy import text
        with SessionLocal.begin() as session:
            session.execute(text("UPDATE admin_gift_imports SET status='failed' WHERE fk_admin_user_id=:admin AND status IN ('queued','running')"), {'admin': self.admin})
