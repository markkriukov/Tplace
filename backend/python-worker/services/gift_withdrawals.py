"""Durable withdrawals to the marketplace owner, using the keeper's Kurigram client."""
import asyncio
import logging

from pyrogram import errors, raw
from sqlalchemy import text

from config import GIFT_WITHDRAW_MAX_STARS
from db import SessionLocal
from db.advisory_locks import GIFT_PERSISTENCE_LOCK
from services.gift_deposits import utc_date

logger = logging.getLogger(__name__)


class GiftWithdrawalError(Exception):
    pass


def next_job():
    # The worker owns the Telegram session lock. There is one withdrawal consumer.
    with SessionLocal() as session:
        # The recipient is the owner's own account; the gift's name is its NFT slug.
        row = session.execute(text('''SELECT w.*, d.custodian_telegram_id, d.owned_gift_id, g.name AS gift_slug,
                g.telegram_gift_id, u.telegram_id AS recipient_telegram_id, u.username AS recipient_username
            FROM gift_withdrawals w JOIN telegram_gift_deposits d ON d.pk_deposit_id=w.fk_deposit_id
            JOIN gifts g ON g.pk_gift_id=w.fk_gift_id JOIN users u ON u.pk_user_id=w.fk_user_id
            WHERE w.status IN ('queued','sending','review') AND w.next_check_at<=now()
              AND (w.status<>'queued' OR NOT EXISTS
                (SELECT 1 FROM gift_action_blocks b WHERE b.fk_gift_id=w.fk_gift_id))
            ORDER BY w.next_check_at,w.pk_gift_withdrawal_id LIMIT 1''')).mappings().first()
        return dict(row) if row else None


def mark_result(job, status, code=None):
    with SessionLocal.begin() as session:
        session.execute(text('''UPDATE gift_withdrawals SET status=:status,error_code=:code,
            completed_at=CASE WHEN :status='failed' THEN now() ELSE completed_at END,
            next_check_at=now()+interval '30 seconds' WHERE pk_gift_withdrawal_id=:id AND status IN ('queued','sending','review') '''),
            {'id': job['pk_gift_withdrawal_id'], 'status': status, 'code': code})
    logger.log(logging.WARNING if status == 'review' else logging.INFO,
               'gift_withdrawal status=%s job_id=%s code=%s', status, job['pk_gift_withdrawal_id'], code)


def validate_owner(session, job):
    session.execute(text('SELECT pk_gift_id FROM gifts WHERE pk_gift_id=:gift FOR UPDATE'), {'gift': job['fk_gift_id']})
    owner = session.execute(text('''SELECT o.fk_user_id,u.telegram_id FROM ownerships o
        JOIN users u ON u.pk_user_id=o.fk_user_id WHERE o.fk_gift_id=:gift FOR UPDATE OF o'''),
        {'gift': job['fk_gift_id']}).mappings().first()
    if not owner or owner['fk_user_id'] != job['fk_user_id'] or owner['telegram_id'] != job['recipient_telegram_id']:
        raise GiftWithdrawalError('OWNER_CHANGED')
    deposit = session.scalar(text('''SELECT pk_deposit_id FROM telegram_gift_deposits WHERE fk_gift_id=:gift
        AND custodian_telegram_id=:custodian ORDER BY message_id DESC LIMIT 1'''),
        {'gift': job['fk_gift_id'], 'custodian': job['custodian_telegram_id']})
    if deposit != job['fk_deposit_id']:
        raise GiftWithdrawalError('DEPOSIT_CHANGED')


def mark_sending(job):
    with SessionLocal.begin() as session:
        session.execute(text('SELECT pk_gift_id FROM gifts WHERE pk_gift_id=:gift FOR UPDATE'),
                        {'gift': job['fk_gift_id']})
        if session.scalar(text('SELECT 1 FROM gift_action_blocks WHERE fk_gift_id=:gift'),
                          {'gift': job['fk_gift_id']}):
            raise GiftWithdrawalError('GIFT_BLOCKED')
        validate_owner(session, job)
        status = session.scalar(text('SELECT status FROM gift_withdrawals WHERE pk_gift_withdrawal_id=:id FOR UPDATE'), {'id': job['pk_gift_withdrawal_id']})
        if status != 'queued':
            raise GiftWithdrawalError('WITHDRAWAL_STATE_CHANGED')
        session.execute(text("UPDATE gift_withdrawals SET status='sending',started_at=now() WHERE pk_gift_withdrawal_id=:id"), {'id': job['pk_gift_withdrawal_id']})


def remember_terms(job, gift):
    with SessionLocal.begin() as session:
        session.execute(text('''UPDATE telegram_gift_deposits SET transfer_star_count=:stars,next_transfer_at=:date
            WHERE pk_deposit_id=:id'''), {'id': job['fk_deposit_id'], 'stars': gift.transfer_star_count,
                              'date': utc_date(gift.next_transfer_date)})


def complete(job):
    with SessionLocal.begin() as session:
        session.execute(text('SELECT pg_advisory_xact_lock(:key)'), {'key': GIFT_PERSISTENCE_LOCK})
        validate_owner(session, job)
        status = session.scalar(text('SELECT status FROM gift_withdrawals WHERE pk_gift_withdrawal_id=:id FOR UPDATE'), {'id': job['pk_gift_withdrawal_id']})
        if status not in ('sending', 'review'):
            raise GiftWithdrawalError('WITHDRAWAL_STATE_CHANGED')
        session.execute(text('''UPDATE gift_withdrawals SET status='completed',error_code=NULL,completed_at=now()
            WHERE pk_gift_withdrawal_id=:id AND status IN ('sending','review')'''), {'id': job['pk_gift_withdrawal_id']})
        session.execute(text('DELETE FROM ownerships WHERE fk_gift_id=:gift AND fk_user_id=:user'),
                        {'gift': job['fk_gift_id'], 'user': job['fk_user_id']})
        session.execute(text('''UPDATE gift_custody_observations SET is_present=false,confirmed_at=NULL,observed_at=now()
            WHERE fk_gift_id=:gift'''), {'gift': job['fk_gift_id']})
    logger.info('gift_withdrawal status=completed job_id=%s recipient_id=%s', job['pk_gift_withdrawal_id'], job['recipient_telegram_id'])


async def recipient_peer(client, job):
    recipient_id = int(job['recipient_telegram_id'])
    try:
        user = await client.get_users(recipient_id)
    except (errors.PeerIdInvalid, errors.UserIdInvalid):
        if not job['recipient_username']:
            raise GiftWithdrawalError('RECIPIENT_UNAVAILABLE')
        user = await client.get_users(job['recipient_username'])
    # Usernames can change hands. Never send to an ID resolved only by username.
    if user.id != recipient_id or user.is_bot or user.id == client.me.id:
        raise GiftWithdrawalError('INVALID_RECIPIENT')
    return await client.resolve_peer(recipient_id)


async def owned_gift(client, job):
    async for gift in client.get_chat_gifts('me', exclude_unlimited=True, exclude_upgradable=True, exclude_non_upgradable=True):
        if int(gift.id) != job['telegram_gift_id']:
            continue
        if str(gift.received_gift_id) != job['owned_gift_id']:
            raise GiftWithdrawalError('DEPOSIT_CHANGED')
        if gift.was_refunded:
            raise GiftWithdrawalError('GIFT_UNAVAILABLE')
        await asyncio.to_thread(remember_terms, job, gift)
        # A receipt or inventory date is a hint, not a transfer rejection.
        # Telegram can allow a transfer before that date; let its RPC decide.
        if (gift.transfer_star_count or 0) > GIFT_WITHDRAW_MAX_STARS:
            raise GiftWithdrawalError('TRANSFER_FEE_TOO_HIGH')
        return gift
    raise GiftWithdrawalError('GIFT_UNAVAILABLE')


def record_fee(job, amount):
    with SessionLocal.begin() as session:
        session.execute(text('UPDATE gift_withdrawals SET transfer_star_count=:amount WHERE pk_gift_withdrawal_id=:id'),
                        {'id': job['pk_gift_withdrawal_id'], 'amount': amount})


async def transfer(client, job, peer, transfer_star_count):
    gift = raw.types.InputSavedStarGiftUser(msg_id=int(job['owned_gift_id']))
    # Telegram's documented paid path starts with GetPaymentForm. Calling the
    # free RPC first can return TRANSFER_TOO_EARLY instead of PAYMENT_REQUIRED.
    if not transfer_star_count:
        try:
            logger.info('gift_withdrawal_rpc job_id=%s method=TransferStarGift', job['pk_gift_withdrawal_id'])
            # Kurigram 2.2.21 counts TOTAL attempts; never retry mutations.
            result = await client.invoke(raw.functions.payments.TransferStarGift(stargift=gift, to_id=peer),
                                         retries=1, sleep_threshold=0, retry_delay=0)
            await asyncio.to_thread(record_fee, job, 0)
            return result
        except errors.PaymentRequired:
            pass  # Fee changed since the inventory read; verify the invoice.
    invoice = raw.types.InputInvoiceStarGiftTransfer(stargift=gift, to_id=peer)
    logger.info('gift_withdrawal_rpc job_id=%s method=GetPaymentForm', job['pk_gift_withdrawal_id'])
    form = await client.invoke(raw.functions.payments.GetPaymentForm(invoice=invoice))
    prices = getattr(getattr(form, 'invoice', None), 'prices', None)
    if not prices or form.invoice.currency != 'XTR' or any(p.amount < 0 for p in prices):
        raise GiftWithdrawalError('INVALID_TRANSFER_INVOICE')
    amount = sum(p.amount for p in prices)
    if amount > GIFT_WITHDRAW_MAX_STARS:
        raise GiftWithdrawalError('TRANSFER_FEE_TOO_HIGH')
    await asyncio.to_thread(record_fee, job, amount)
    logger.info('gift_withdrawal_rpc job_id=%s method=SendStarsForm stars=%s', job['pk_gift_withdrawal_id'], amount)
    result = await client.invoke(raw.functions.payments.SendStarsForm(form_id=form.form_id, invoice=invoice),
                                 retries=1, sleep_threshold=0, retry_delay=0)
    if not isinstance(result, raw.types.payments.PaymentResult):
        # Never start a second payment when a confirmation is pending.
        raise RuntimeError('TRANSFER_CONFIRMATION_REQUIRED')
    return result


async def confirm_delivery(client, job):
    gift = await client.get_upgraded_gift(job['gift_slug'])
    if int(gift.id) != job['telegram_gift_id']:
        return False
    if getattr(getattr(gift, 'owner', None), 'id', None) != job['recipient_telegram_id']:
        return False
    await asyncio.to_thread(complete, job)
    return True


async def process_next_withdrawal(client, lock):
    async with lock:
        job = await asyncio.to_thread(next_job)
        if not job:
            return False
        if client.me.id != job['custodian_telegram_id']:
            await asyncio.to_thread(mark_result, job, 'review', 'CUSTODY_ACCOUNT_MISMATCH')
            return True
        if job['status'] in ('sending', 'review'):
            # A crash or timeout may occur after Telegram has already delivered.
            # Recovery only checks delivery; it never submits another transfer.
            try:
                if await asyncio.wait_for(confirm_delivery(client, job), timeout=60):
                    return True
            except Exception:
                logger.warning('gift_withdrawal_confirm_failed job_id=%s', job['pk_gift_withdrawal_id'], exc_info=True)
            await asyncio.to_thread(mark_result, job, 'review', 'TRANSFER_RESULT_UNKNOWN')
            return True
        sending = False
        try:
            gift = await asyncio.wait_for(owned_gift(client, job), timeout=120)
            peer = await asyncio.wait_for(recipient_peer(client, job), timeout=30)
            await asyncio.to_thread(mark_sending, job)
            sending = True
            await asyncio.wait_for(transfer(client, job, peer, gift.transfer_star_count), timeout=180)
            # Successful transfer/payment RPC confirms delivery even when the
            # recipient hides the owner of the gift on their public profile.
            await asyncio.to_thread(complete, job)
        except GiftWithdrawalError as error:
            if str(error) == 'GIFT_BLOCKED':
                return True  # Keep the reservation; a conflict cannot authorize a refund.
            await asyncio.to_thread(mark_result, job, 'failed' if not sending or str(error) in (
                'TRANSFER_FEE_TOO_HIGH', 'INVALID_TRANSFER_INVOICE') else 'review', str(error))
        except Exception as error:
            # Once submission began, even a timeout/DB failure cannot prove non-delivery.
            definitive = {
                'BalanceTooLow': 'INSUFFICIENT_STARS',
                'StargiftTransferTooEarly': 'TRANSFER_LOCKED',
                'PeerIdInvalid': 'RECIPIENT_UNAVAILABLE',
                'UsernameNotOccupied': 'RECIPIENT_UNAVAILABLE',
                'UserIdInvalid': 'RECIPIENT_UNAVAILABLE',
                'UserDisallowedStargifts': 'RECIPIENT_UNAVAILABLE',
                'UserGiftUnavailable': 'RECIPIENT_UNAVAILABLE',
                'UserPrivacyRestricted': 'RECIPIENT_UNAVAILABLE',
                'UserIsBlocked': 'RECIPIENT_UNAVAILABLE',
                'UserBlocked': 'RECIPIENT_UNAVAILABLE',
                'YouBlockedUser': 'RECIPIENT_UNAVAILABLE',
                'InputUserDeactivated': 'RECIPIENT_UNAVAILABLE',
            }.get(type(error).__name__)
            code = definitive or ('TRANSFER_RESULT_UNKNOWN' if sending else 'WITHDRAWAL_PRECHECK_FAILED')
            await asyncio.to_thread(mark_result, job, 'review' if sending and not definitive else 'failed', code)
            logger.warning('gift_withdrawal_failed job_id=%s error_type=%s', job['pk_gift_withdrawal_id'], type(error).__name__, exc_info=True)
        return True
