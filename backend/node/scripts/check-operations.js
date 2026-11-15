import { sequelize } from '../src/db/sequelize.js'
import { logError } from '../src/log.js'
import { MAX_NANO } from '../src/modules/wallet/wallet-money.utils.js'

try {
  const [rows] = await sequelize.query(`SELECT
    (SELECT count(*) FROM ton_payments WHERE status = 'review')::int AS reviews,
    (SELECT count(*) FROM ton_unmatched_deposits WHERE status = 'open')::int AS unmatched_deposits,
    (SELECT count(*) FROM gift_withdrawals WHERE status = 'review')::int AS gift_withdrawal_reviews,
    (SELECT count(*) FROM gift_withdrawals WHERE status IN ('queued','sending') AND created_at < now() - interval '20 minutes')::int AS overdue_gift_withdrawals,
    (SELECT count(*) FROM ton_payments WHERE status IN ('queued','broadcast') AND created_at < now() - interval '20 minutes')::int AS overdue_payments,
    (SELECT count(*) FROM offers WHERE status = 'pending' AND expires_at < now() - interval '1 minute')::int AS overdue_offers,
    (SELECT count(*) FROM wallet_balances WHERE available_nano < 0 OR locked_nano < 0 OR available_nano + locked_nano > ${MAX_NANO})::int AS invalid_balances`)
  // The Python worker records each custody reconciliation pass under this name.
  const [[reconcile]] = await sequelize.query("SELECT last_success_at FROM worker_status WHERE name = 'custody_reconcile'")
  const alertAfterMs = Number(process.env.CUSTODY_RECONCILE_ALERT_AFTER_SECONDS || 7200) * 1000
  const staleReconcile = process.env.CUSTODY_RECONCILE_ALERTS === 'true' &&
    (!reconcile?.last_success_at || Date.now() - new Date(reconcile.last_success_at).getTime() > alertAfterMs)
  const health = { ...rows[0], stale_custody_reconcile: staleReconcile }
  const failed = Object.values(health).some(Boolean)
  console.log(JSON.stringify({ event: failed ? 'operations_alert' : 'operations_healthy', ...health }))
  if (failed) process.exitCode = 1
} catch (error) {
  logError('operations_check_failed', error)
  process.exitCode = 1
} finally { await sequelize.close() }
