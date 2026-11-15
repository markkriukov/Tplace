import asyncio
import logging
import signal
import traceback

if __name__ == '__main__':
    from environment import load_project_environment

    load_project_environment()

from sqlalchemy import text

from config import CUSTODY_RECONCILE_INTERVAL_SECONDS, renamed_settings_in_use
from db import SessionLocal, init_database
from integrations.telegram_client import create_telegram_client, listening_client
from services.gift_deposits import GiftDeposits
from services.gift_import import process_next_import_async, telegram_session_lock
from services.gift_withdrawals import process_next_withdrawal

logger = logging.getLogger(__name__)

# worker_status name checked by the Node operations monitor (scripts/check-operations.js).
CUSTODY_RECONCILE_STATUS = 'custody_reconcile'


def record_status(name, success):
    column = 'last_success_at' if success else 'last_error_at'
    with SessionLocal.begin() as session:
        session.execute(text(f'''INSERT INTO worker_status(name,{column}) VALUES (:name,now())
            ON CONFLICT(name) DO UPDATE SET {column}=now()'''), {'name': name})


async def poll_imports(client):
    while True:
        try:
            await process_next_import_async(client)
        except Exception as error:
            logger.error('gift_import_polling_failed error_type=%s', type(error).__name__, exc_info=True)
        await asyncio.sleep(2)


async def poll_withdrawals(client, deposits):
    while True:
        try:
            await process_next_withdrawal(client, deposits.lock)
        except Exception as error:
            logger.error('gift_withdrawal_polling_failed error_type=%s', type(error).__name__, exc_info=True)
        await asyncio.sleep(2)


async def reconcile_custody(deposits):
    while True:
        delay = max(1, CUSTODY_RECONCILE_INTERVAL_SECONDS)
        try:
            await deposits.reconcile()
            await asyncio.to_thread(record_status, CUSTODY_RECONCILE_STATUS, True)
        except Exception as error:
            logger.error('custody_reconcile_failed error_type=%s', type(error).__name__, exc_info=True)
            try:
                await asyncio.to_thread(record_status, CUSTODY_RECONCILE_STATUS, False)
            except Exception:
                logger.exception('custody_status_write_failed')
            delay = 30
        try:
            await asyncio.wait_for(deposits.needs_reconcile.wait(), timeout=delay)
        except TimeoutError:
            pass


async def run_worker():
    init_database()
    # Only one process may open this SQLite session. All reads share its client.
    with telegram_session_lock() as acquired:
        if not acquired:
            logger.warning('Telegram session is in use by another worker')
            return
        client = create_telegram_client(receive_updates=True)
        deposits = GiftDeposits(client)
        deposits.register()
        async with listening_client(client):
            logger.info('Custody listener started telegram_user_id=%s', client.me.id)
            tasks = [asyncio.create_task(poll_imports(client)),
                     asyncio.create_task(poll_withdrawals(client, deposits)),
                     asyncio.create_task(reconcile_custody(deposits))]
            try:
                await asyncio.gather(*tasks)
            finally:
                for task in tasks:
                    task.cancel()
                await asyncio.gather(*tasks, return_exceptions=True)


async def main_async():
    loop = asyncio.get_running_loop()
    task = asyncio.current_task()
    try:
        loop.add_signal_handler(signal.SIGTERM, task.cancel)
    except NotImplementedError:
        pass  # Windows uses KeyboardInterrupt; production runs on Linux.
    while True:
        try:
            await run_worker()
        except Exception as error:
            logger.error('worker_restart error_type=%s', type(error).__name__, exc_info=True)
        await asyncio.sleep(10)


class FramesOnlyFormatter(logging.Formatter):
    """Log exception types and frames, never messages: driver errors embed SQL parameters."""

    def formatException(self, exc_info):
        error_type, error, tb = exc_info
        frames = ''.join(traceback.format_tb(tb)).rstrip()
        cause = (error.__cause__ or error.__context__) if error else None
        suffix = f' (cause {type(cause).__name__})' if cause else ''
        return f'Traceback:\n{frames}\n{error_type.__name__}{suffix}'


def main():
    problems = renamed_settings_in_use()
    if problems:
        raise SystemExit('Invalid configuration:\n- ' + '\n- '.join(problems))
    handler = logging.StreamHandler()
    handler.setFormatter(FramesOnlyFormatter('%(asctime)s %(levelname)s %(name)s %(message)s'))
    logging.basicConfig(level=logging.INFO, handlers=[handler])
    try:
        asyncio.run(main_async())
    except (KeyboardInterrupt, asyncio.CancelledError):
        pass


if __name__ == '__main__':
    main()
