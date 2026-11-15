"""Admin imports are bounded, atomic additions, never custody synchronization."""
import asyncio
import json
import logging
from contextlib import contextmanager

from sqlalchemy import select, text
from db import SessionLocal, User
from db.advisory_locks import GIFT_PERSISTENCE_LOCK, TELEGRAM_SESSION_LOCK
from db.session import engine
from mappers.telegram_gift import telegram_display_name, is_regular_gift
from services.gift_persistence import save_gift_batch

logger = logging.getLogger(__name__)


class GiftImportError(Exception):
    def __init__(self, code):
        super().__init__(code)
        self.code = code


@contextmanager
def telegram_session_lock():
    # A session-level lock spans Telegram calls without holding a DB transaction.
    # The listener holds it for its lifetime and shares its client with imports.
    with engine.connect() as connection:
        acquired = connection.scalar(text('SELECT pg_try_advisory_lock(:key)'), {'key': TELEGRAM_SESSION_LOCK})
        connection.commit()
        try:
            yield acquired
        finally:
            if acquired:
                connection.execute(text('SELECT pg_advisory_unlock(:key)'), {'key': TELEGRAM_SESSION_LOCK})
                connection.commit()


async def fetch_import_gifts(username, max_count, client):
    # The worker owns this connection and the session lock for its lifetime.
    gifts = []
    user = await client.get_users(username)
    async for gift in client.get_chat_gifts(
        user.id, limit=max_count, exclude_unlimited=True,
        exclude_upgradable=True, exclude_non_upgradable=True,
    ):
        gifts.append(gift)
        if len(gifts) >= max_count:
            break
    return user, gifts


def error_code(error):
    if isinstance(error, GiftImportError):
        return error.code
    if isinstance(error, TimeoutError):
        return 'IMPORT_TIMEOUT'
    name = type(error).__name__
    if name in {'UsernameInvalid', 'UsernameNotOccupied', 'PeerIdInvalid', 'UserIdInvalid'}:
        return 'TELEGRAM_USER_NOT_FOUND'
    if name in {'AuthKeyUnregistered', 'SessionRevoked', 'SessionExpired', 'Unauthorized'}:
        return 'TELEGRAM_AUTH_REQUIRED'
    if name == 'FloodWait':
        return 'TELEGRAM_RATE_LIMIT'
    return 'IMPORT_FAILED'


def claim_import():
    with SessionLocal.begin() as session:
        # Holding the session lock proves no previous importer is still active.
        session.execute(text("UPDATE admin_gift_imports SET status='failed', error_code='WORKER_RESTARTED', completed_at=now() WHERE status='running'"))
        job = session.execute(text("""
            UPDATE admin_gift_imports SET status='running', started_at=now()
            WHERE pk_gift_import_id=(SELECT pk_gift_import_id FROM admin_gift_imports WHERE status='queued'
              ORDER BY pk_gift_import_id LIMIT 1 FOR UPDATE SKIP LOCKED)
            RETURNING pk_gift_import_id, fk_admin_user_id, username, max_count
        """)).mappings().first()
        return dict(job) if job else None


def check_import_admin(job):
    with SessionLocal() as session:
        admin = session.get(User, job['fk_admin_user_id'])
        if admin is None or not admin.is_admin:
            raise GiftImportError('ADMIN_REQUIRED')


def save_import(job, user, gifts):
    eligible = [gift for gift in gifts if not is_regular_gift(gift) and int(getattr(gift, 'id', 0)) > 0]
    with SessionLocal.begin() as session:
        # Same lock order as deposits: persistence lock, then users.
        session.execute(text('SELECT pg_advisory_xact_lock(:key)'), {'key': GIFT_PERSISTENCE_LOCK})
        admin = session.scalar(select(User).where(User.pk_user_id == job['fk_admin_user_id']).with_for_update())
        if admin is None or not admin.is_admin:
            raise GiftImportError('ADMIN_REQUIRED')
        status = session.scalar(text('SELECT status FROM admin_gift_imports WHERE pk_gift_import_id=:id FOR UPDATE'), {'id': job['pk_gift_import_id']})
        if status != 'running':
            raise GiftImportError('WORKER_RESTARTED')
        added, missing = save_gift_batch(telegram_display_name(user.first_name, user.username, job['username']), eligible,
                                          session=session, owner_id=admin.pk_user_id)
        # Gifts whose attributes are not in the catalog yet are skipped, not created.
        result = {'fetched': len(gifts), 'added': added, 'skipped': len(gifts) - added,
                  'missing_catalog': len(missing), 'source_telegram_id': str(user.id)}
        session.execute(text("""UPDATE admin_gift_imports SET status='completed', result=CAST(:result AS jsonb), completed_at=now()
            WHERE pk_gift_import_id=:id"""), {'id': job['pk_gift_import_id'], 'result': json.dumps(result)})


def fail_import(job, code):
    with SessionLocal.begin() as session:
        session.execute(text("UPDATE admin_gift_imports SET status='failed', error_code=:code, completed_at=now() WHERE pk_gift_import_id=:id AND status='running'"),
                        {'id': job['pk_gift_import_id'], 'code': code})


async def process_next_import_async(client):
    # Each synchronous session lives entirely in its worker thread. Database
    # waits must not block Telegram updates, withdrawal polling or custody reconciliation.
    job = await asyncio.to_thread(claim_import)
    if job is None:
        return False
    try:
        await asyncio.to_thread(check_import_admin, job)
        user, gifts = await asyncio.wait_for(fetch_import_gifts(job['username'], job['max_count'], client), timeout=180)
        await asyncio.to_thread(save_import, job, user, gifts)
    except Exception as error:
        code = error_code(error)
        logger.warning('gift_import_failed job_id=%s code=%s error_type=%s', job['pk_gift_import_id'], code, type(error).__name__, exc_info=True)
        await asyncio.to_thread(fail_import, job, code)
    return True
