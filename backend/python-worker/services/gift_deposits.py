"""Receive collectible gifts into custody and credit their Telegram sender."""
import asyncio
import logging
from datetime import UTC, datetime

from pyrogram import filters, raw
from pyrogram.enums import ChatType, UpgradedGiftOrigin
from sqlalchemy import select, text

from db import Gift, SessionLocal
from db.advisory_locks import GIFT_PERSISTENCE_LOCK
from config import GIFT_CUSTODY_SCAN_TIMEOUT_SECONDS
from mappers.telegram_gift import telegram_display_name, is_regular_gift
from repositories.gifts import upsert_user
from services.gift_persistence import complete_custody_snapshot, save_gift_batch
from services.gift_replacement import remove_test_gift

logger = logging.getLogger(__name__)


class CatalogEntryMissingError(Exception):
    """The gift names an attribute the Changes API catalog does not have yet."""

    def __init__(self, gift_id, attribute):
        super().__init__(f'Gift {gift_id}: {attribute} is not in the catalog')
        self.attribute = attribute


def utc_date(value):
    if value is not None and value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value


def deposit_sender(message, custodian_id):
    """Only actual incoming transfers; original_details describes an older gift."""
    gift = getattr(message, 'gift', None)
    chat = getattr(message, 'chat', None)
    if (gift is None or is_regular_gift(gift)
            or getattr(chat, 'type', None) != ChatType.PRIVATE
            or getattr(message, 'outgoing', False)
            or getattr(message, 'forward_origin', None)
            or getattr(gift, 'was_refunded', False)
            or getattr(gift, 'origin', None) not in (None, UpgradedGiftOrigin.TRANSFER)
            or int(getattr(gift, 'id', 0)) <= 0
            or int(getattr(message, 'id', 0)) <= 0):
        return None
    # sender is the current transfer's sender, never the original NFT giver.
    sender = getattr(gift, 'sender', None) or getattr(message, 'from_user', None)
    sender_id = getattr(sender, 'id', 0)
    if (sender_id <= 0 or sender_id in (custodian_id, 777000)
            or getattr(sender, 'is_bot', False)
            or getattr(sender, 'type', ChatType.PRIVATE) != ChatType.PRIVATE):
        return None
    recipient_confirmed = False
    for participant in ('receiver', 'owner'):
        peer = getattr(gift, participant, None)
        if peer is not None and peer.id != custodian_id:
            return None
        recipient_confirmed |= peer is not None and peer.id == custodian_id
    if gift.origin is None:
        # Telegram can omit `transferred` on a received unique gift. Kurigram
        # then leaves origin unset. Require the real service action and recipient,
        # and reject every known non-deposit action even if its origin is missing.
        action = getattr(gift, 'raw', None)
        if not isinstance(action, raw.types.MessageActionStarGiftUnique) or not recipient_confirmed:
            return None
        if any(getattr(action, flag, None) for flag in (
                'upgrade', 'refunded', 'assigned', 'from_offer', 'prepaid_upgrade', 'resale_amount', 'craft')):
            return None
    return sender


def save_deposit(custodian, message):
    sender = deposit_sender(message, custodian.id)
    if sender is None:
        gift = getattr(message, 'gift', None)
        logger.info('gift_deposit_ignored message_id=%s gift_id=%s gift_type=%s origin=%s outgoing=%s',
                    message.id, getattr(gift, 'id', None), getattr(gift, 'type', None),
                    getattr(gift, 'origin', None), getattr(message, 'outgoing', None))
        return 'ignored'
    gift = message.gift
    with SessionLocal.begin() as session:
        session.execute(text('SELECT pg_advisory_xact_lock(:key)'), {'key': GIFT_PERSISTENCE_LOCK})
        receipt = {'custodian': custodian.id, 'message': message.id}
        if session.scalar(text('''SELECT pk_deposit_id FROM telegram_gift_deposits
                WHERE custodian_telegram_id=:custodian AND message_id=:message'''), receipt):
            return 'duplicate'
        # Lock the gift before touching its ownership, as marketplace trades do.
        stored = session.scalar(select(Gift).where(Gift.telegram_gift_id == gift.id).with_for_update())
        if stored is not None and stored.is_test_import:
            remove_test_gift(session, stored)
            stored = None
        owner = upsert_user(session, sender)
        keeper = upsert_user(session, custodian)
        if stored is None:
            _, missing = save_gift_batch(telegram_display_name(custodian.first_name, custodian.username, str(custodian.id)),
                                          [gift], session=session, owner_id=owner.pk_user_id, custodian_id=keeper.pk_user_id)
            if missing:
                # Roll back; reconciliation retries once the catalog sync adds the attribute.
                raise CatalogEntryMissingError(gift.id, missing[0][1])
            stored_id = session.scalar(select(Gift.pk_gift_id).where(Gift.telegram_gift_id == gift.id))
            status = 'credited'
        else:
            # Any new receipt for an existing real NFT is a conflict, including
            # the same sender or a returned NFT whose withdrawal has completed.
            # Do not create or reassign ownership, even if no owner remains.
            stored_id = stored.pk_gift_id
            status = 'ownership_conflict'
            session.execute(text('''INSERT INTO gift_action_blocks(fk_gift_id,reason)
                VALUES (:gift,'DUPLICATE_REAL_DEPOSIT') ON CONFLICT DO NOTHING'''), {'gift': stored_id})
            session.execute(text('''INSERT INTO gift_custody_observations(fk_gift_id,fk_custodian_user_id)
                VALUES (:gift,:keeper) ON CONFLICT(fk_gift_id) DO UPDATE
                SET fk_custodian_user_id=EXCLUDED.fk_custodian_user_id'''),
                {'gift': stored_id, 'keeper': keeper.pk_user_id})
        session.execute(text('''UPDATE gift_custody_observations
            SET is_present=true, observed_at=now(), confirmed_at=now() WHERE fk_gift_id=:gift'''),
            {'gift': stored_id})
        received_at = utc_date(getattr(message, 'date', None)) or datetime.now(UTC)
        session.execute(text('''INSERT INTO telegram_gift_deposits
            (custodian_telegram_id, message_id, chat_id, sender_telegram_id, fk_gift_id, status, received_at,
             owned_gift_id, received_gift_id, transfer_star_count, next_transfer_at, next_resale_at, export_at)
            VALUES (:custodian, :message, :chat, :sender, :gift, :status, :received,
                    :owned, :received_id, :stars, :transfer_at, :resale_at, :export_at)'''),
            {**receipt, 'chat': message.chat.id, 'sender': sender.id, 'gift': stored_id,
             'status': status, 'received': received_at, 'owned': str(message.id),
             'received_id': getattr(gift, 'received_gift_id', None) or str(message.id),
             'stars': getattr(gift, 'transfer_star_count', None),
             'transfer_at': utc_date(getattr(gift, 'next_transfer_date', None)),
             'resale_at': utc_date(getattr(gift, 'next_resale_date', None)),
             'export_at': utc_date(getattr(gift, 'export_date', None))})
    logger.log(logging.WARNING if status == 'ownership_conflict' else logging.INFO,
               'gift_deposit status=%s gift_id=%s sender_id=%s message_id=%s',
               status, gift.id, sender.id, message.id)
    return status


def processed_messages(custodian_id, message_ids):
    if not message_ids:
        return set()
    with SessionLocal() as session:
        return set(session.scalars(text('''SELECT message_id FROM telegram_gift_deposits
            WHERE custodian_telegram_id=:custodian AND message_id=ANY(CAST(:ids AS bigint[]))'''),
            {'custodian': custodian_id, 'ids': list(message_ids)}))


class GiftDeposits:
    def __init__(self, client):
        self.client = client
        self.lock = asyncio.Lock()
        self.needs_reconcile = asyncio.Event()

    def register(self):
        @self.client.on_message(filters.private & filters.incoming & filters.gift)
        async def receive(client, message):
            async with self.lock:
                try:
                    await asyncio.to_thread(save_deposit, client.me, message)
                except CatalogEntryMissingError as error:
                    logger.warning('gift_deposit_catalog_missing message_id=%s missing=%s', message.id, error.attribute)
                except Exception as error:
                    self.needs_reconcile.set()
                    logger.error('gift_deposit_failed message_id=%s error_type=%s', message.id, type(error).__name__, exc_info=True)

    async def reconcile(self):
        # Serialize with live deposits so a scan cannot overwrite a newer event.
        async with self.lock:
            self.needs_reconcile.clear()
            custodian = self.client.me
            deadline = asyncio.get_running_loop().time() + GIFT_CUSTODY_SCAN_TIMEOUT_SECONDS
            async with asyncio.timeout_at(deadline):
                gifts = [gift async for gift in self.client.get_chat_gifts(
                    'me', exclude_unlimited=True, exclude_upgradable=True, exclude_non_upgradable=True)]
            receipt_ids = {int(gift.received_gift_id) for gift in gifts
                           if str(getattr(gift, 'received_gift_id', '')).isdigit()}
            known = await asyncio.to_thread(processed_messages, custodian.id, receipt_ids)
            seen = []
            for gift in gifts:
                if is_regular_gift(gift):
                    continue
                seen.append(int(gift.id))
                receipt_id = getattr(gift, 'received_gift_id', None)
                if not receipt_id or not str(receipt_id).isdigit():
                    logger.warning('gift_deposit_unidentified gift_id=%s', gift.id)
                    continue
                if int(receipt_id) in known:
                    continue
                async with asyncio.timeout_at(deadline):
                    message = await self.client.get_messages('me', int(receipt_id))
                if getattr(getattr(message, 'gift', None), 'id', None) != gift.id:
                    logger.warning('gift_deposit_message_missing gift_id=%s', gift.id)
                    continue
                try:
                    await asyncio.to_thread(save_deposit, custodian, message)
                except CatalogEntryMissingError as error:
                    # Other gifts and the inventory snapshot must not wait for the catalog.
                    logger.warning('gift_deposit_catalog_missing gift_id=%s missing=%s', gift.id, error.attribute)
            # Await DB threads outside the timeout: canceling to_thread would
            # release the lock while its transaction was still running.
            if asyncio.get_running_loop().time() >= deadline:
                raise TimeoutError('Custody scan exceeded its time budget')
            # Only a complete successful inventory scan may publish absence.
            await asyncio.to_thread(complete_inventory, custodian, seen)
            logger.info('custody_reconciled telegram_user_id=%s gifts=%s', custodian.id, len(seen))


def complete_inventory(custodian, seen):
    with SessionLocal.begin() as session:
        run_id = session.scalar(text("SELECT nextval('gift_custody_sync_run_seq')"))
    complete_custody_snapshot(custodian, run_id, seen)
