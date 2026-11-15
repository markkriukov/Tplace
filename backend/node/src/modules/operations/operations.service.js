import { httpMetrics } from '../../http/metrics.js'
import { sequelize } from '../../db/sequelize.js'

export async function getOperations() {
  const [payments] = await sequelize.query(`SELECT status, count(*)::text AS count,
    extract(epoch FROM now() - min(created_at))::bigint::text AS oldest_age_seconds
    FROM ton_payments WHERE status IN ('queued','broadcast','review','pending') GROUP BY status`)
  const [workers] = await sequelize.query('SELECT name, last_success_at, last_error_at FROM worker_status')
  // The recipient is the withdrawal owner's Telegram account.
  const [giftWithdrawals] = await sequelize.query(`SELECT w.public_id::text AS id, g.public_id::text AS gift_id,
    u.telegram_id::text AS recipient_telegram_id, w.status, w.error_code, w.fee_nano::text, w.created_at, w.started_at
    FROM gift_withdrawals w
    JOIN gifts g ON g.pk_gift_id = w.fk_gift_id JOIN users u ON u.pk_user_id = w.fk_user_id
    WHERE w.status IN ('queued','sending','review') ORDER BY w.pk_gift_withdrawal_id LIMIT 100`)
  const [offers] = await sequelize.query("SELECT count(*)::text AS overdue FROM offers WHERE status = 'pending' AND expires_at <= now()")
  const [giftBlocks] = await sequelize.query(`SELECT g.public_id::text AS gift_id, g.telegram_gift_id::text,
    b.reason, b.created_at FROM gift_action_blocks b JOIN gifts g ON g.pk_gift_id = b.fk_gift_id
    ORDER BY b.created_at, b.fk_gift_id LIMIT 100`)
  const [unmatchedDeposits] = await sequelize.query(`SELECT d.public_id::text AS id, d.reason, d.amount_nano::text, d.sender_address,
    d.memo, d.tx_hash, d.received_at, p.public_id::text AS payment_id FROM ton_unmatched_deposits d
    LEFT JOIN ton_payments p ON p.pk_payment_id = d.fk_payment_id
    WHERE d.status = 'open' ORDER BY d.pk_unmatched_deposit_id LIMIT 100`)
  return { payload: { ok: true, http: httpMetrics(), payments, workers, gift_withdrawals: giftWithdrawals,
    gift_blocks: giftBlocks, overdue_offers: offers[0].overdue, unmatched_deposits: unmatchedDeposits } }
}
