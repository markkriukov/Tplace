import path from 'node:path'
import { Sequelize } from 'sequelize'
import { DATABASE_SETTINGS } from '../config.js'

const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required')
}

// The payment worker holds one connection for its advisory lock while settling
// on others, so the default pool of 5 would leave little room for HTTP traffic.
const { poolMax, slowQueryMs, statementTimeoutMs, lockTimeoutMs, idleInTransactionTimeoutMs } = DATABASE_SETTINGS

export const sequelize = new Sequelize(databaseUrl, {
  dialect: 'postgres',
  pool: { max: poolMax, acquire: 10_000 },
  // Sent as startup parameters; a zero value is omitted (no limit).
  dialectOptions: {
    // pg_stat_activity shows the API (index) apart from scripts such as seed.
    application_name: `tplace-node:${path.basename(process.argv[1] ?? 'node', '.js')}`,
    statement_timeout: statementTimeoutMs,
    lock_timeout: lockTimeoutMs,
    idle_in_transaction_session_timeout: idleInTransactionTimeoutMs,
  },
  benchmark: slowQueryMs > 0,
  // Deliberately omit SQL text: it may contain user data and token values.
  logging: slowQueryMs > 0 ? (_sql, durationMs) => {
    if (durationMs >= slowQueryMs) console.warn(JSON.stringify({ event: 'slow_query', durationMs }))
  } : false,
})

/** Lifts the connection limits until `transaction` ends: migrations and catalog
 * sync run long, and lock-holding worker passes idle while they call the network. */
export function withoutTimeouts(transaction, database = sequelize) {
  return database.query(`SET LOCAL statement_timeout = 0; SET LOCAL lock_timeout = 0;
    SET LOCAL idle_in_transaction_session_timeout = 0`, { transaction })
}
