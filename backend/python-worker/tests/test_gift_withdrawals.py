import asyncio
import unittest
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from pyrogram import errors, raw
from sqlalchemy import text

from database_fixture import requires_database
from test_gift_deposits import fixture
from catalog_fixture import seed_catalog
from db import SessionLocal, User, init_database
from services import gift_withdrawals as withdrawals
from services.gift_deposits import save_deposit


@requires_database
class WithdrawalTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        init_database()
        self.keeper, self.sender, self.message = fixture()
        seed_catalog(self.message.gift)
        save_deposit(self.keeper, self.message)
        with SessionLocal.begin() as session:
            buyer = User(telegram_id=self.keeper.id + 20, username='current_owner')
            session.add(buyer)
            session.flush()
            self.buyer_pk, self.buyer_id = buyer.pk_user_id, buyer.telegram_id
            self.deposit = session.execute(text('SELECT * FROM telegram_gift_deposits WHERE message_id=:id'),
                                           {'id': self.message.id}).mappings().one()
            self.gift_pk = self.deposit['fk_gift_id']
            # Marketplace sale: current owner differs from the depositor.
            session.execute(text('UPDATE ownerships SET fk_user_id=:buyer WHERE fk_gift_id=:gift'),
                            {'buyer': self.buyer_pk, 'gift': self.gift_pk})
            session.execute(text('''INSERT INTO wallet_balances(fk_user_id,available_nano,locked_nano)
                VALUES (:buyer,750000000,250000000)
                ON CONFLICT (fk_user_id) DO UPDATE SET available_nano=EXCLUDED.available_nano,
                locked_nano=EXCLUDED.locked_nano'''), {'buyer': self.buyer_pk})
            fee_tx = session.scalar(text('''INSERT INTO wallet_transactions
                (fk_user_id,tx_kind,direction,status,amount_nano,fk_gift_id,balance_before_nano,balance_after_nano)
                VALUES (:buyer,'gift_withdrawal_fee','debit','pending',250000000,:gift,1000000000,1000000000)
                RETURNING pk_wallet_tx_id'''), {'buyer': self.buyer_pk, 'gift': self.gift_pk})
            self.job_id = session.scalar(text('''INSERT INTO gift_withdrawals
                (fk_gift_id,fk_deposit_id,fk_user_id,request_key,fee_nano,fk_fee_wallet_tx_id)
                VALUES (:gift,:deposit,:buyer,:key,250000000,:fee_tx) RETURNING pk_gift_withdrawal_id'''),
                {'gift': self.gift_pk, 'deposit': self.deposit['pk_deposit_id'], 'buyer': self.buyer_pk,
                 'key': str(self.message.id), 'fee_tx': fee_tx})
        self.message.gift.transfer_star_count = 0
        self.message.gift.next_transfer_date = None
        async def gifts(*args, **kwargs):
            yield self.message.gift
        self.client = SimpleNamespace(
            me=self.keeper, get_chat_gifts=gifts,
            get_users=AsyncMock(return_value=SimpleNamespace(id=self.buyer_id, is_bot=False)),
            resolve_peer=AsyncMock(return_value=raw.types.InputPeerUser(user_id=self.buyer_id, access_hash=123)),
            invoke=AsyncMock(return_value=raw.types.Updates(updates=[], users=[], chats=[], date=0, seq=0)),
            get_upgraded_gift=AsyncMock(return_value=SimpleNamespace(id=self.message.gift.id, owner=SimpleNamespace(id=self.buyer_id))),
        )

    async def asyncTearDown(self):
        with SessionLocal.begin() as session:
            session.execute(text("UPDATE gift_withdrawals SET status='failed' WHERE pk_gift_withdrawal_id=:id AND status IN ('queued','sending','review')"), {'id': self.job_id})

    def job(self):
        with SessionLocal() as session:
            # Like next_job(): the recipient is the owner's Telegram account.
            return dict(session.execute(text('''SELECT w.*, u.telegram_id AS recipient_telegram_id FROM gift_withdrawals w
                JOIN users u ON u.pk_user_id=w.fk_user_id WHERE w.pk_gift_withdrawal_id=:id'''), {'id': self.job_id}).mappings().one())

    def owner(self):
        with SessionLocal() as session:
            return session.scalar(text('SELECT fk_user_id FROM ownerships WHERE fk_gift_id=:id'), {'id': self.gift_pk})

    def allow_recheck(self):
        with SessionLocal.begin() as session:
            session.execute(text("UPDATE gift_withdrawals SET next_check_at=now()-interval '1 second' WHERE pk_gift_withdrawal_id=:id"), {'id': self.job_id})

    async def process(self):
        await withdrawals.process_next_withdrawal(self.client, asyncio.Lock())
        # Every transfer/recovery scenario also checks the financial outcome.
        job = self.job()
        with SessionLocal() as session:
            wallet = session.execute(text('SELECT *, available_nano+locked_nano AS total_nano FROM wallet_balances WHERE fk_user_id=:id'),
                                     {'id': self.buyer_pk}).mappings().one()
            revenue = session.scalar(text('SELECT count(*) FROM marketplace_fee_entries WHERE fk_gift_withdrawal_id=:id'), {'id': self.job_id})
            if not job['fee_nano']:
                self.assertEqual((wallet['available_nano'], wallet['locked_nano'], wallet['total_nano']), (1000000000, 0, 1000000000))
                self.assertEqual(revenue, 0)
                return
            ledger = session.execute(text('SELECT * FROM wallet_transactions WHERE pk_wallet_tx_id=:id'),
                                     {'id': job['fk_fee_wallet_tx_id']}).mappings().one()
            if job['status'] == 'completed':
                self.assertEqual((wallet['available_nano'], wallet['locked_nano'], wallet['total_nano']), (750000000, 0, 750000000))
                self.assertEqual(ledger['status'], 'completed')
                self.assertEqual(ledger['balance_before_nano'] - ledger['balance_after_nano'], 250000000)
                self.assertEqual(revenue, 1)
            elif job['status'] == 'failed':
                self.assertEqual((wallet['available_nano'], wallet['locked_nano'], wallet['total_nano']), (1000000000, 0, 1000000000))
                self.assertEqual(ledger['status'], 'canceled')
                self.assertEqual(revenue, 0)
            else:
                self.assertEqual((wallet['available_nano'], wallet['locked_nano'], wallet['total_nano']), (750000000, 250000000, 1000000000))
                self.assertEqual(ledger['status'], 'pending')
                self.assertEqual(revenue, 0)

    async def test_sale_then_withdrawal_sends_to_buyer_not_depositor_and_preserves_history(self):
        await self.process()
        request = self.client.invoke.await_args.args[0]
        self.assertIsInstance(request, raw.functions.payments.TransferStarGift)
        self.assertEqual(request.to_id.user_id, self.buyer_id)
        self.assertNotEqual(request.to_id.user_id, self.sender.id)
        self.assertEqual(request.stargift.msg_id, self.message.id)
        self.assertEqual(self.client.invoke.await_args.kwargs['retries'], 1)
        self.assertEqual(self.job()['status'], 'completed')
        self.assertIsNone(self.owner())
        with SessionLocal() as session:
            self.assertFalse(session.scalar(text('SELECT is_present FROM gift_custody_observations WHERE fk_gift_id=:id'), {'id': self.gift_pk}))
            self.assertEqual(session.scalar(text('SELECT count(*) FROM telegram_gift_deposits WHERE fk_gift_id=:id'), {'id': self.gift_pk}), 1)
            self.assertEqual(session.scalar(text('SELECT count(*) FROM gifts WHERE pk_gift_id=:id'), {'id': self.gift_pk}), 1)
        await self.process()
        self.client.invoke.assert_awaited_once()

    async def test_timeout_freezes_gift_then_recovers_without_resending(self):
        self.client.invoke.side_effect = TimeoutError()
        await self.process()
        self.assertEqual(self.job()['status'], 'review')
        self.assertEqual(self.owner(), self.buyer_pk)
        self.allow_recheck()
        await self.process()
        self.assertEqual(self.job()['status'], 'completed')
        self.client.invoke.assert_awaited_once()

    async def test_restart_after_submission_only_checks_delivery(self):
        with SessionLocal.begin() as session:
            session.execute(text("UPDATE gift_withdrawals SET status='sending' WHERE pk_gift_withdrawal_id=:id"), {'id': self.job_id})
        await self.process()
        self.assertEqual(self.job()['status'], 'completed')
        self.client.invoke.assert_not_awaited()

    async def test_unknown_delivery_does_not_unlock_or_retry(self):
        self.client.invoke.side_effect = TimeoutError()
        self.client.get_upgraded_gift.return_value.owner.id = self.keeper.id
        await self.process()
        self.assertEqual(self.job()['status'], 'review')
        self.allow_recheck()
        await self.process()
        self.assertEqual(self.job()['status'], 'review')
        self.assertEqual(self.owner(), self.buyer_pk)
        self.client.invoke.assert_awaited_once()

    async def test_future_inventory_date_does_not_override_successful_telegram_transfer(self):
        self.message.gift.next_transfer_date = datetime.now(UTC) + timedelta(days=7)
        await self.process()
        self.assertEqual(self.job()['status'], 'completed')
        self.assertIsNone(self.owner())
        self.client.invoke.assert_awaited_once()

    async def test_stale_deposit_date_is_cleared_from_live_inventory_before_transfer(self):
        with SessionLocal.begin() as session:
            session.execute(text("UPDATE telegram_gift_deposits SET next_transfer_at=now()+interval '7 days' WHERE pk_deposit_id=:id"), {'id': self.deposit['pk_deposit_id']})
        await self.process()
        self.assertEqual(self.job()['status'], 'completed')
        with SessionLocal() as session:
            self.assertIsNone(session.scalar(text('SELECT next_transfer_at FROM telegram_gift_deposits WHERE pk_deposit_id=:id'), {'id': self.deposit['pk_deposit_id']}))
        self.client.invoke.assert_awaited_once()

    async def test_actual_telegram_transfer_rejection_preserves_ownership(self):
        self.message.gift.next_transfer_date = datetime.now(UTC) + timedelta(days=1)
        self.client.invoke.side_effect = errors.StargiftTransferTooEarly()
        await self.process()
        self.assertEqual(self.job()['status'], 'failed')
        self.assertEqual(self.job()['error_code'], 'TRANSFER_LOCKED')
        self.assertEqual(self.owner(), self.buyer_pk)
        self.client.invoke.assert_awaited_once()

    async def test_successful_rpc_completes_even_when_recipient_hides_public_ownership(self):
        self.client.get_upgraded_gift.return_value.owner = None
        await self.process()
        self.assertEqual(self.job()['status'], 'completed')
        self.assertIsNone(self.owner())

    async def test_changed_owner_prevents_submission(self):
        with SessionLocal.begin() as session:
            original = session.scalar(text('SELECT pk_user_id FROM users WHERE telegram_id=:id'), {'id': self.sender.id})
            session.execute(text('UPDATE ownerships SET fk_user_id=:owner WHERE fk_gift_id=:gift'), {'owner': original, 'gift': self.gift_pk})
        await self.process()
        self.assertEqual(self.job()['error_code'], 'OWNER_CHANGED')
        self.client.invoke.assert_not_awaited()

    async def test_recycled_username_is_not_used_as_recipient(self):
        self.client.get_users.side_effect = [errors.PeerIdInvalid(), SimpleNamespace(id=self.sender.id, is_bot=False)]
        await self.process()
        self.assertEqual(self.job()['error_code'], 'INVALID_RECIPIENT')
        self.client.invoke.assert_not_awaited()

    async def test_paid_transfer_uses_invoice_even_when_free_transfer_is_too_early(self):
        self.message.gift.transfer_star_count = 25
        self.message.gift.next_transfer_date = datetime.now(UTC) + timedelta(days=7)
        form = raw.types.payments.PaymentFormStarGift(form_id=55, invoice=raw.types.Invoice(
            currency='XTR', prices=[raw.types.LabeledPrice(label='Transfer', amount=25)]))
        async def telegram(request, **kwargs):
            if isinstance(request, raw.functions.payments.TransferStarGift):
                raise errors.StargiftTransferTooEarly()
            if isinstance(request, raw.functions.payments.GetPaymentForm):
                return form
            if isinstance(request, raw.functions.payments.SendStarsForm):
                return raw.types.payments.PaymentResult(updates=raw.types.Updates(updates=[], users=[], chats=[], date=0, seq=0))
            raise AssertionError(type(request).__name__)
        self.client.invoke.side_effect = telegram
        await self.process()
        self.assertEqual(self.job()['status'], 'completed')
        self.assertEqual(self.job()['transfer_star_count'], 25)
        payment = self.client.invoke.await_args.args[0]
        self.assertIsInstance(payment, raw.functions.payments.SendStarsForm)
        self.assertEqual(payment.invoice.to_id.user_id, self.buyer_id)
        self.assertEqual(self.client.invoke.await_args.kwargs['retries'], 1)
        self.assertEqual(self.client.invoke.await_count, 2)

    async def test_paid_transfer_rejects_an_invoice_over_the_fee_cap(self):
        self.message.gift.transfer_star_count = 25
        self.client.invoke.return_value = raw.types.payments.PaymentFormStarGift(form_id=55, invoice=raw.types.Invoice(
            currency='XTR', prices=[raw.types.LabeledPrice(label='Transfer', amount=99)]))
        await self.process()
        self.assertEqual(self.job()['status'], 'failed')
        self.assertEqual(self.job()['error_code'], 'TRANSFER_FEE_TOO_HIGH')
        self.assertEqual(self.owner(), self.buyer_pk)
        self.client.invoke.assert_awaited_once()
        self.assertIsInstance(self.client.invoke.await_args.args[0], raw.functions.payments.GetPaymentForm)

    async def test_paid_payment_timeout_recovers_without_second_payment(self):
        self.message.gift.transfer_star_count = 25
        form = raw.types.payments.PaymentFormStarGift(form_id=55, invoice=raw.types.Invoice(
            currency='XTR', prices=[raw.types.LabeledPrice(label='Transfer', amount=25)]))
        self.client.invoke.side_effect = [form, TimeoutError()]
        await self.process()
        self.assertEqual(self.job()['status'], 'review')
        self.assertEqual(self.owner(), self.buyer_pk)
        self.allow_recheck()
        await self.process()
        self.assertEqual(self.job()['status'], 'completed')
        self.assertEqual(self.client.invoke.await_count, 2)

    async def test_paid_invoice_telegram_rejection_preserves_ownership(self):
        self.message.gift.transfer_star_count = 25
        self.client.invoke.side_effect = errors.StargiftTransferTooEarly()
        await self.process()
        self.assertEqual(self.job()['status'], 'failed')
        self.assertEqual(self.job()['error_code'], 'TRANSFER_LOCKED')
        self.assertEqual(self.owner(), self.buyer_pk)
        self.client.invoke.assert_awaited_once()
        self.assertIsInstance(self.client.invoke.await_args.args[0], raw.functions.payments.GetPaymentForm)

    async def test_fee_increase_cannot_trigger_payment(self):
        form = raw.types.payments.PaymentFormStarGift(form_id=55, invoice=raw.types.Invoice(
            currency='XTR', prices=[raw.types.LabeledPrice(label='Transfer', amount=99)]))
        self.client.invoke.side_effect = [errors.PaymentRequired(), form]
        await self.process()
        self.assertEqual(self.job()['error_code'], 'TRANSFER_FEE_TOO_HIGH')
        self.assertEqual(self.job()['status'], 'failed')
        self.assertEqual(self.client.invoke.await_count, 2)
        self.assertEqual(self.owner(), self.buyer_pk)

    async def test_insufficient_stars_rejection_releases_withdrawal_lock(self):
        self.message.gift.transfer_star_count = 25
        form = raw.types.payments.PaymentFormStarGift(form_id=55, invoice=raw.types.Invoice(
            currency='XTR', prices=[raw.types.LabeledPrice(label='Transfer', amount=25)]))
        self.client.invoke.side_effect = [form, errors.BalanceTooLow()]
        await self.process()
        self.assertEqual(self.job()['status'], 'failed')
        self.assertEqual(self.job()['error_code'], 'INSUFFICIENT_STARS')
        self.assertEqual(self.owner(), self.buyer_pk)

    async def test_db_failure_after_delivery_recovers_without_second_transfer(self):
        with patch.object(withdrawals, 'complete', side_effect=RuntimeError('Database unavailable')):
            await self.process()
        self.assertEqual(self.job()['status'], 'review')
        self.assertEqual(self.owner(), self.buyer_pk)
        self.allow_recheck()
        await self.process()
        self.assertEqual(self.job()['status'], 'completed')
        self.client.invoke.assert_awaited_once()

    async def test_new_deposit_of_existing_real_gift_after_completed_withdrawal_is_blocked(self):
        await self.process()
        self.message.id += 1
        self.message.gift.received_gift_id = str(self.message.id)
        self.assertEqual(save_deposit(self.keeper, self.message), 'ownership_conflict')
        with SessionLocal() as session:
            self.assertTrue(session.scalar(text('SELECT 1 FROM gift_action_blocks WHERE fk_gift_id=:gift'),
                                           {'gift': self.gift_pk}))
        self.assertIsNone(self.owner())
        self.assertEqual(self.job()['status'], 'completed')

    async def test_redeposit_does_not_confirm_unknown_withdrawal_or_release_fee(self):
        self.client.invoke.side_effect = TimeoutError()
        await self.process()
        self.message.id += 1
        self.message.gift.received_gift_id = str(self.message.id)
        self.assertEqual(save_deposit(self.keeper, self.message), 'ownership_conflict')
        self.client.get_upgraded_gift.return_value.owner.id = self.keeper.id
        self.allow_recheck()
        await self.process()
        self.assertEqual(self.job()['status'], 'review')
        self.assertEqual(self.owner(), self.buyer_pk)
        self.client.invoke.assert_awaited_once()

    async def test_conflict_stops_queued_withdrawal_and_preserves_reservation(self):
        stale_job = withdrawals.next_job()
        self.message.id += 1
        self.assertEqual(save_deposit(self.keeper, self.message), 'ownership_conflict')
        await self.process()
        self.assertEqual(self.job()['status'], 'queued')
        self.client.invoke.assert_not_awaited()
        self.client.get_users.assert_not_awaited()
        # Even an already selected job cannot pass the final locked check.
        with self.assertRaisesRegex(withdrawals.GiftWithdrawalError, 'GIFT_BLOCKED'):
            withdrawals.mark_sending(stale_job)

    async def test_failure_after_fee_settlement_rolls_back_and_recovers_once(self):
        original = SessionLocal.class_.execute
        def fail_ownership_delete(session, statement, *args, **kwargs):
            if str(statement).startswith('DELETE FROM ownerships'):
                raise RuntimeError('Injected failure after fee settlement')
            return original(session, statement, *args, **kwargs)
        with patch.object(SessionLocal.class_, 'execute', new=fail_ownership_delete):
            await self.process()
        self.assertEqual(self.job()['status'], 'review')
        self.assertEqual(self.owner(), self.buyer_pk)
        self.allow_recheck()
        await self.process()
        self.assertEqual(self.job()['status'], 'completed')
        await self.process()
        self.client.invoke.assert_awaited_once()

    async def test_terminal_failure_cannot_refund_twice_or_be_reopened(self):
        self.client.invoke.side_effect = errors.StargiftTransferTooEarly()
        await self.process()
        withdrawals.mark_result(self.job(), 'failed', 'TRANSFER_LOCKED')
        withdrawals.mark_result(self.job(), 'review', 'LATE_RESULT')
        await self.process()
        self.assertEqual(self.job()['status'], 'failed')
        self.client.invoke.assert_awaited_once()

    async def test_legacy_request_remains_free(self):
        withdrawals.mark_result(self.job(), 'failed', 'TEST_LEGACY_SETUP')
        with SessionLocal.begin() as session:
            self.job_id = session.scalar(text('''INSERT INTO gift_withdrawals
                (fk_gift_id,fk_deposit_id,fk_user_id,request_key)
                VALUES (:gift,:deposit,:buyer,'legacy-free') RETURNING pk_gift_withdrawal_id'''),
                {'gift': self.gift_pk, 'deposit': self.deposit['pk_deposit_id'], 'buyer': self.buyer_pk})
        await self.process()
        self.assertEqual(self.job()['status'], 'completed')
