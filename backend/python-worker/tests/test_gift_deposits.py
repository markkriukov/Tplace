import asyncio
import copy
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from database_fixture import requires_database
from pyrogram import enums, raw, types
from services import gift_deposits as deposits
from catalog_fixture import seed_catalog


def fixture():
    identifier = time.time_ns() // 1000
    custodian = types.User(id=identifier, first_name='Keeper', username='keeper')
    sender = types.User(id=identifier + 1, first_name='Sender', username='sender')
    gift = types.Gift(
        id=identifier + 2, type=enums.GiftType.UPGRADED, origin=enums.UpgradedGiftOrigin.TRANSFER,
        name=f'CrystalFox-{identifier}', sender=sender,
        receiver=types.Chat(id=custodian.id, type=enums.ChatType.PRIVATE),
        owner=types.Chat(id=custodian.id, type=enums.ChatType.PRIVATE),
        model=types.GiftAttribute(type=enums.GiftAttributeType.MODEL, name='Deposit model', rarity=15),
        symbol=types.GiftAttribute(type=enums.GiftAttributeType.SYMBOL, name='Deposit symbol', rarity=20),
        backdrop=types.GiftAttribute(type=enums.GiftAttributeType.BACKDROP, name='Deposit backdrop', rarity=25),
        received_gift_id=str(identifier + 3), regular_gift_id=identifier + 4, raw=None,
    )
    message = types.Message(id=identifier + 3, date=datetime.now(UTC), gift=gift, from_user=sender,
                            chat=types.Chat(id=sender.id, type=enums.ChatType.PRIVATE), outgoing=False)
    return custodian, sender, message


def received_without_transfer_flag(custodian, message):
    """Shape observed on a real incoming user gift in Kurigram 2.2.21."""
    gift = message.gift
    gift.origin = None
    gift.sender = gift.receiver = gift.received_gift_id = None
    message.outgoing = None
    gift.raw = raw.types.MessageActionStarGiftUnique(
        gift=raw.types.StarGiftUnique(
            id=gift.id, gift_id=123, title='Crystal Fox', slug=gift.name, num=1,
            attributes=[], availability_issued=1, availability_total=100,
            owner_id=raw.types.PeerUser(user_id=custodian.id)),
        transferred=False, saved=True, upgrade=False, refunded=False,
        assigned=False, from_offer=False, prepaid_upgrade=False, craft=False,
        transfer_stars=25,
    )
    return gift.raw


class DepositFilterTests(unittest.TestCase):
    def test_received_service_message_without_transfer_flag_uses_actual_sender(self):
        keeper, sender, message = fixture()
        received_without_transfer_flag(keeper, message)
        self.assertEqual(deposits.deposit_sender(message, keeper.id).id, sender.id)

    def test_missing_origin_requires_service_action_and_confirmed_recipient(self):
        keeper, _, message = fixture()
        received_without_transfer_flag(keeper, message)
        message.gift.owner = None
        self.assertIsNone(deposits.deposit_sender(message, keeper.id))
        message.gift.owner = types.Chat(id=keeper.id, type=enums.ChatType.PRIVATE)
        message.gift.raw = None
        self.assertIsNone(deposits.deposit_sender(message, keeper.id))

    def test_missing_origin_never_credits_other_gift_actions_or_telegram_service_user(self):
        keeper, _, message = fixture()
        for flag in ('upgrade', 'refunded', 'assigned', 'from_offer', 'prepaid_upgrade', 'resale_amount', 'craft'):
            with self.subTest(flag=flag):
                action = received_without_transfer_flag(keeper, message)
                setattr(action, flag, True)
                self.assertIsNone(deposits.deposit_sender(message, keeper.id))
        received_without_transfer_flag(keeper, message)
        message.from_user = types.User(id=777000, first_name='Telegram')
        self.assertIsNone(deposits.deposit_sender(message, keeper.id))

    def test_current_sender_is_used_and_original_giver_is_ignored(self):
        keeper, sender, message = fixture()
        message.gift.original_details = SimpleNamespace(from_user=SimpleNamespace(id=100))
        self.assertEqual(deposits.deposit_sender(message, keeper.id).id, sender.id)
        message.gift.sender = None
        self.assertEqual(deposits.deposit_sender(message, keeper.id).id, sender.id)

    def test_non_deposits_never_produce_an_owner(self):
        keeper, sender, original = fixture()
        changes = [
            ('outgoing', True), ('forward_origin', SimpleNamespace(date=datetime.now(UTC))),
            ('chat', types.Chat(id=-1001, type=enums.ChatType.CHANNEL)),
            ('gift', None), ('id', 0),
        ]
        for key, value in changes:
            with self.subTest(key=key):
                message = copy.copy(original)
                setattr(message, key, value)
                self.assertIsNone(deposits.deposit_sender(message, keeper.id))
        changes = [
            ('type', enums.GiftType.REGULAR), ('was_refunded', True),
            ('origin', enums.UpgradedGiftOrigin.UPGRADE), ('origin', enums.UpgradedGiftOrigin.RESALE),
            ('sender', keeper), ('sender', types.Chat(id=-10, type=enums.ChatType.CHANNEL)),
            ('receiver', types.Chat(id=98765, type=enums.ChatType.PRIVATE)),
            ('owner', types.Chat(id=98765, type=enums.ChatType.PRIVATE)),
        ]
        for key, value in changes:
            with self.subTest(gift_field=key, value=value):
                message = copy.copy(original)
                message.gift = copy.copy(original.gift)
                setattr(message.gift, key, value)
                self.assertIsNone(deposits.deposit_sender(message, keeper.id))
        original.gift.sender = original.from_user = None
        self.assertIsNone(deposits.deposit_sender(original, keeper.id))


class ClientLifecycleTests(unittest.IsolatedAsyncioTestCase):
    async def test_kurigram_parses_received_action_without_origin(self):
        keeper, sender, message = fixture()
        action = received_without_transfer_flag(keeper, message)
        message.gift = await types.Gift._parse_action(None, action, users={
            keeper.id: raw.types.User(id=keeper.id, first_name=keeper.first_name, usernames=[], restriction_reason=[])})
        self.assertIsNone(message.gift.origin)
        self.assertEqual(deposits.deposit_sender(message, keeper.id).id, sender.id)
        self.assertEqual(message.gift.transfer_star_count, 25)

    async def test_listener_initializes_dispatcher_and_closes_it(self):
        from integrations.telegram_client import listening_client
        keeper, _, _ = fixture()
        client = SimpleNamespace(connect=AsyncMock(return_value=True), get_me=AsyncMock(return_value=keeper),
                                 invoke=AsyncMock(), initialize=AsyncMock(), terminate=AsyncMock(),
                                 disconnect=AsyncMock(), is_connected=True, is_initialized=True)
        async with listening_client(client):
            self.assertEqual(client.me.id, keeper.id)
            client.initialize.assert_awaited_once()
        client.terminate.assert_awaited_once()
        client.disconnect.assert_awaited_once()

    async def test_listener_does_not_prompt_for_authorization(self):
        from integrations.telegram_client import listening_client
        client = SimpleNamespace(connect=AsyncMock(return_value=False), disconnect=AsyncMock(),
                                 is_connected=True, is_initialized=False)
        with self.assertRaisesRegex(RuntimeError, 'TELEGRAM_AUTH_REQUIRED'):
            async with listening_client(client):
                self.fail('Unauthorized session was used')
        client.disconnect.assert_awaited_once()

    async def test_listener_rejects_a_different_custodian_before_dispatch(self):
        from integrations import telegram_client
        keeper, _, _ = fixture()
        client = SimpleNamespace(connect=AsyncMock(return_value=True), get_me=AsyncMock(return_value=keeper),
                                 initialize=AsyncMock(), disconnect=AsyncMock(),
                                 is_connected=True, is_initialized=False)
        with patch.object(telegram_client, 'CUSTODY_TELEGRAM_USER_ID', str(keeper.id + 1)):
            with self.assertRaisesRegex(RuntimeError, 'CUSTODY_ACCOUNT_MISMATCH'):
                async with telegram_client.listening_client(client):
                    self.fail('Wrong custodian was used')
        client.initialize.assert_not_awaited()
        client.disconnect.assert_awaited_once()

    async def test_shared_import_does_not_reopen_or_disconnect_client(self):
        from services.gift_import import fetch_import_gifts
        keeper, _, message = fixture()
        async def gifts(*args, **kwargs):
            yield message.gift
        client = SimpleNamespace(get_users=AsyncMock(return_value=keeper), get_chat_gifts=gifts,
                                 connect=AsyncMock(), disconnect=AsyncMock())
        user, result = await fetch_import_gifts('keeper', 1, client)
        self.assertEqual(result, [message.gift])
        client.connect.assert_not_awaited()
        client.disconnect.assert_not_awaited()

    async def test_registered_handler_retries_failed_write_via_reconciliation(self):
        keeper, _, message = fixture()
        class Client:
            me = keeper
            def on_message(self, filter):
                def register(handler):
                    self.handler = handler
                    return handler
                return register
        client = Client()
        listener = deposits.GiftDeposits(client)
        listener.register()
        with patch.object(deposits, 'save_deposit', side_effect=RuntimeError('db unavailable')):
            await client.handler(client, message)
        self.assertTrue(listener.needs_reconcile.is_set())


@requires_database
class DepositPersistenceTests(unittest.TestCase):
    def setUp(self):
        from db import init_database
        init_database()
        self.keeper, self.sender, self.message = fixture()
        seed_catalog(self.message.gift)

    def user_pk(self, user):
        from db import SessionLocal
        from repositories.gifts import upsert_user
        with SessionLocal.begin() as session:
            return int(upsert_user(session, user).pk_user_id)

    def row(self):
        from db import SessionLocal
        from sqlalchemy import text
        with SessionLocal() as session:
            return session.execute(text('''SELECT g.pk_gift_id, g.is_test_import, u.telegram_id AS owner,
                    k.telegram_id AS keeper, o.is_present, o.confirmed_at,
                    (SELECT count(*) FROM telegram_gift_deposits d WHERE d.fk_gift_id=g.pk_gift_id) AS receipts
                FROM gifts g JOIN ownerships own ON own.fk_gift_id=g.pk_gift_id
                JOIN users u ON u.pk_user_id=own.fk_user_id
                JOIN gift_custody_observations o ON o.fk_gift_id=g.pk_gift_id
                JOIN users k ON k.pk_user_id=o.fk_custodian_user_id WHERE g.telegram_gift_id=:id'''),
                {'id': self.message.gift.id}).mappings().first()

    def test_new_deposit_creates_sender_inventory_and_separate_custody(self):
        self.message.gift.received_gift_id = None  # Live user actions may omit saved_id.
        self.message.gift.transfer_star_count = 25
        self.message.gift.next_transfer_date = datetime(2026, 10, 3, 12, 0)
        self.message.gift.next_resale_date = datetime(2026, 10, 4, 12, 0, tzinfo=UTC)
        self.message.gift.export_date = datetime(2026, 10, 5, 12, 0, tzinfo=UTC)
        self.assertEqual(deposits.save_deposit(self.keeper, self.message), 'credited')
        row = self.row()
        self.assertEqual(row['owner'], self.sender.id)
        self.assertEqual(row['keeper'], self.keeper.id)
        self.assertFalse(row['is_test_import'])
        self.assertTrue(row['is_present'])
        self.assertIsNotNone(row['confirmed_at'])
        self.assertEqual(row['receipts'], 1)
        from db import SessionLocal
        from sqlalchemy import text
        with SessionLocal() as session:
            receipt = session.execute(text('SELECT * FROM telegram_gift_deposits WHERE fk_gift_id=:gift'),
                                      {'gift': row['pk_gift_id']}).mappings().one()
        self.assertEqual(receipt['owned_gift_id'], str(self.message.id))
        self.assertEqual(receipt['received_gift_id'], str(self.message.id))
        # The NFT slug is the gift's name; the receipt does not repeat it.
        self.assertNotIn('gift_slug', receipt)
        with SessionLocal() as session:
            self.assertEqual(session.scalar(text('SELECT name FROM gifts WHERE pk_gift_id=:gift'),
                                            {'gift': row['pk_gift_id']}), self.message.gift.name)
        self.assertEqual(receipt['transfer_star_count'], 25)
        self.assertEqual(receipt['next_transfer_at'], self.message.gift.next_transfer_date.replace(tzinfo=UTC))
        self.assertEqual(receipt['next_resale_at'], self.message.gift.next_resale_date)
        self.assertEqual(receipt['export_at'], self.message.gift.export_date)

    def test_duplicate_after_sale_preserves_buyer_and_absence(self):
        from db import SessionLocal, User
        from sqlalchemy import text
        deposits.save_deposit(self.keeper, self.message)
        row = self.row()
        with SessionLocal.begin() as session:
            buyer = User(telegram_id=self.keeper.id + 10)
            session.add(buyer)
            session.flush()
            session.execute(text('UPDATE ownerships SET fk_user_id=:buyer WHERE fk_gift_id=:gift'),
                            {'buyer': buyer.pk_user_id, 'gift': row['pk_gift_id']})
            session.execute(text('UPDATE gift_custody_observations SET is_present=false WHERE fk_gift_id=:gift'),
                            {'gift': row['pk_gift_id']})
        self.assertEqual(deposits.save_deposit(self.keeper, self.message), 'duplicate')
        row = self.row()
        self.assertEqual(row['owner'], self.keeper.id + 10)
        self.assertFalse(row['is_present'])
        self.assertEqual(row['receipts'], 1)

    def test_concurrent_delivery_credits_only_once(self):
        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = [pool.submit(deposits.save_deposit, self.keeper, self.message) for _ in range(2)]
            self.assertEqual(sorted(f.result() for f in futures), ['credited', 'duplicate'])
        self.assertEqual(self.row()['receipts'], 1)

    def test_failed_write_rolls_back_gift_owner_and_receipt_then_retries(self):
        save = deposits.save_gift_batch
        def fail(*args, **kwargs):
            save(*args, **kwargs)
            raise RuntimeError('Injected failure')
        with patch.object(deposits, 'save_gift_batch', side_effect=fail):
            with self.assertRaisesRegex(RuntimeError, 'Injected failure'):
                deposits.save_deposit(self.keeper, self.message)
        self.assertIsNone(self.row())
        self.assertEqual(deposits.save_deposit(self.keeper, self.message), 'credited')

    def test_existing_owner_conflict_is_recorded_without_reassignment(self):
        from services.gift_persistence import save_gift_batch
        other = types.User(id=self.keeper.id + 20, first_name='Existing', username='existing')
        other_pk = self.user_pk(other)
        save_gift_batch('Existing', [self.message.gift], owner_id=other_pk, custodian_id=other_pk)
        self.assertEqual(deposits.save_deposit(self.keeper, self.message), 'ownership_conflict')
        self.assertEqual(self.row()['owner'], other.id)
        self.assertEqual(self.row()['keeper'], self.keeper.id)

    def test_new_receipt_for_same_real_owner_blocks_and_reconciliation_never_unblocks(self):
        from db import SessionLocal
        from sqlalchemy import text
        self.assertEqual(deposits.save_deposit(self.keeper, self.message), 'credited')
        self.assertEqual(deposits.save_deposit(self.keeper, self.message), 'duplicate')
        with SessionLocal() as session:
            self.assertFalse(session.scalar(text('SELECT 1 FROM gift_action_blocks WHERE fk_gift_id=:gift'),
                                            {'gift': self.row()['pk_gift_id']}))
        self.message.id += 1
        self.assertEqual(deposits.save_deposit(self.keeper, self.message), 'ownership_conflict')
        self.assertEqual(deposits.save_deposit(self.keeper, self.message), 'duplicate')
        gift_id = self.row()['pk_gift_id']
        deposits.complete_inventory(self.keeper, [self.message.gift.id])
        with SessionLocal() as session:
            self.assertTrue(session.scalar(text('SELECT 1 FROM gift_action_blocks WHERE fk_gift_id=:gift'), {'gift': gift_id}))

    def test_test_gift_replacement_preserves_history_refunds_once_and_is_atomic(self):
        from db import SessionLocal, User
        from sqlalchemy import text
        from services.gift_persistence import save_gift_batch
        with SessionLocal.begin() as session:
            admin = User(telegram_id=self.keeper.id + 30)
            buyers = [User(telegram_id=self.keeper.id + 31), User(telegram_id=self.keeper.id + 32)]
            session.add_all([admin, *buyers])
            session.flush()
            save_gift_batch('Test source', [self.message.gift], session=session, owner_id=admin.pk_user_id)
            gift_id = session.scalar(text('SELECT pk_gift_id FROM gifts WHERE telegram_gift_id=:id'), {'id': self.message.gift.id})
            params = {'gift': gift_id, 'seller': admin.pk_user_id}
            listing_id = session.scalar(text('''INSERT INTO gift_listings(fk_gift_id,fk_seller_user_id,price_nano)
                VALUES (:gift,:seller,5000000000) RETURNING pk_gift_listing_id'''), params)
            sold_id = session.scalar(text('''INSERT INTO gift_listings(fk_gift_id,fk_seller_user_id,price_nano,status,closed_reason)
                VALUES (:gift,:seller,1000000000,'sold','sold_direct') RETURNING pk_gift_listing_id'''), params)
            fee_id = session.scalar(text('''INSERT INTO marketplace_fee_entries(fk_gift_listing_id,currency_code,amount_nano)
                VALUES (:listing,'GRAM',5000000) RETURNING pk_marketplace_fee_id'''), {'listing': sold_id})
            buyer_ids = [buyer.pk_user_id for buyer in buyers]
            for buyer_id in buyer_ids:
                session.execute(text('''INSERT INTO wallet_balances(fk_user_id,available_nano,locked_nano)
                    VALUES (:user,1000000000,2000000000)
                    ON CONFLICT (fk_user_id) DO UPDATE SET available_nano=EXCLUDED.available_nano,
                    locked_nano=EXCLUDED.locked_nano'''), {'user': buyer_id})
                session.execute(text('''INSERT INTO offers(fk_gift_id,fk_seller_user_id,fk_buyer_user_id,
                    currency_code,amount_nano,escrow_locked_nano)
                    VALUES (:gift,:seller,:buyer,'GRAM',2000000000,2000000000)'''), {**params, 'buyer': buyer_id})
        # A failure after the old gift has been removed rolls EVERYTHING back.
        with patch.object(deposits, 'save_gift_batch', side_effect=RuntimeError('Injected replacement failure')):
            with self.assertRaisesRegex(RuntimeError, 'Injected replacement failure'):
                deposits.save_deposit(self.keeper, self.message)
        with SessionLocal() as session:
            self.assertTrue(session.scalar(text('SELECT is_test_import FROM gifts WHERE pk_gift_id=:id'), {'id': gift_id}))
            self.assertEqual(session.scalar(text("SELECT count(*) FROM offers WHERE fk_gift_id=:gift AND status='pending'"), {'gift': gift_id}), 2)
            for buyer_id in buyer_ids:
                self.assertEqual(session.scalar(text('SELECT locked_nano FROM wallet_balances WHERE fk_user_id=:user'), {'user': buyer_id}), 2000000000)
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: deposits.save_deposit(self.keeper, self.message), range(2)))
        self.assertEqual(sorted(results), ['credited', 'duplicate'])
        row = self.row()
        self.assertNotEqual(row['pk_gift_id'], gift_id)
        self.assertEqual(row['owner'], self.sender.id)
        self.assertFalse(row['is_test_import'])
        with SessionLocal() as session:
            self.assertIsNone(session.scalar(text('SELECT pk_gift_id FROM gifts WHERE pk_gift_id=:id'), {'id': gift_id}))
            listing = session.execute(text('SELECT status,fk_gift_id FROM gift_listings WHERE pk_gift_listing_id=:id'), {'id': listing_id}).one()
            self.assertEqual(tuple(listing), ('canceled', None))
            self.assertEqual(session.scalar(text('SELECT status FROM gift_listings WHERE pk_gift_listing_id=:id'), {'id': sold_id}), 'sold')
            self.assertEqual(session.scalar(text('SELECT amount_nano FROM marketplace_fee_entries WHERE pk_marketplace_fee_id=:id'), {'id': fee_id}), 5000000)
            for buyer_id in buyer_ids:
                wallet = session.execute(text('SELECT available_nano,locked_nano,available_nano+locked_nano FROM wallet_balances WHERE fk_user_id=:user'), {'user': buyer_id}).one()
                self.assertEqual(tuple(wallet), (3000000000, 0, 3000000000))
                self.assertEqual(session.scalar(text("SELECT count(*) FROM wallet_transactions WHERE fk_user_id=:user AND tx_kind='offer_escrow_release'"), {'user': buyer_id}), 1)
                offer = session.execute(text('SELECT status,escrow_locked_nano,fk_gift_id FROM offers WHERE fk_buyer_user_id=:user'), {'user': buyer_id}).one()
                self.assertEqual(tuple(offer), ('canceled', 0, None))

    def test_admin_import_racing_real_deposit_never_retains_test_ownership(self):
        from db import SessionLocal, User
        from sqlalchemy import text
        from services.gift_persistence import save_gift_batch
        with SessionLocal.begin() as session:
            admin = User(telegram_id=self.keeper.id + 40)
            session.add(admin)
            session.flush()
            admin_id = admin.pk_user_id
        with ThreadPoolExecutor(max_workers=2) as pool:
            imported = pool.submit(save_gift_batch, 'Source', [self.message.gift], owner_id=admin_id)
            deposited = pool.submit(deposits.save_deposit, self.keeper, self.message)
            imported.result(timeout=10)
            self.assertEqual(deposited.result(timeout=10), 'credited')
        row = self.row()
        self.assertEqual(row['owner'], self.sender.id)
        self.assertFalse(row['is_test_import'])
        with SessionLocal() as session:
            self.assertEqual(session.scalar(text('SELECT count(*) FROM gifts WHERE telegram_gift_id=:gift'),
                                            {'gift': self.message.gift.id}), 1)

    def test_reconciliation_recovers_missed_message_and_only_full_scan_marks_absence(self):
        test = self
        class Client:
            me = test.keeper
            fail = False
            inventory = [test.message.gift]
            get_messages = AsyncMock(return_value=test.message)
            async def get_chat_gifts(self, chat, **options):
                test.assertEqual(chat, 'me')
                for gift in self.inventory:
                    yield gift
                if self.fail:
                    raise RuntimeError('Incomplete scan')
        client = Client()
        async def scenario():
            listener = deposits.GiftDeposits(client)
            await listener.reconcile()
            self.assertEqual(self.row()['owner'], self.sender.id)
            await listener.reconcile()
            client.get_messages.assert_awaited_once()
            client.inventory, client.fail = [], True
            with self.assertRaisesRegex(RuntimeError, 'Incomplete scan'):
                await listener.reconcile()
            self.assertTrue(self.row()['is_present'])
            client.fail = False
            await listener.reconcile()
            self.assertFalse(self.row()['is_present'])
        asyncio.run(scenario())

    def test_deposit_missing_from_catalog_is_retried_without_blocking_reconciliation(self):
        from db import SessionLocal
        from sqlalchemy import text
        test = self
        # Same custodian, but its collection has not been synced from the Changes API yet.
        unknown = copy.deepcopy(self.message)
        unknown.id += 10
        unknown.gift.id += 10
        unknown.gift.received_gift_id = str(unknown.id)
        unknown.gift.regular_gift_id += 10
        with self.assertRaises(deposits.CatalogEntryMissingError):
            deposits.save_deposit(self.keeper, unknown)
        with SessionLocal() as session:
            self.assertFalse(session.scalar(text('SELECT 1 FROM gifts WHERE telegram_gift_id=:id'), {'id': unknown.gift.id}))
            self.assertFalse(session.scalar(text('SELECT 1 FROM telegram_gift_deposits WHERE message_id=:id'),
                                            {'id': unknown.id}))
        messages = {int(self.message.gift.received_gift_id): self.message, unknown.id: unknown}
        class Client:
            me = test.keeper
            async def get_chat_gifts(self, chat, **options):
                yield unknown.gift
                yield test.message.gift
            async def get_messages(self, chat, message_id):
                return messages[message_id]
        asyncio.run(deposits.GiftDeposits(Client()).reconcile())
        self.assertEqual(self.row()['owner'], self.sender.id)
        seed_catalog(unknown.gift)
        self.assertEqual(deposits.save_deposit(self.keeper, unknown), 'credited')

    def test_missing_transfer_flag_deposit_is_credited_once_with_withdrawal_reference(self):
        received_without_transfer_flag(self.keeper, self.message)
        self.assertEqual(deposits.save_deposit(self.keeper, self.message), 'credited')
        self.assertEqual(deposits.save_deposit(self.keeper, self.message), 'duplicate')
        row = self.row()
        self.assertEqual(row['owner'], self.sender.id)
        self.assertEqual(row['keeper'], self.keeper.id)
        self.assertEqual(row['receipts'], 1)
