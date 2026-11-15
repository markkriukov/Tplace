import { sequelize } from './sequelize.js'
import { assertMigrationsCurrent } from './migrations.js'
import './models.js'
import { DATABASE_SETTINGS } from '../config.js'

const { connectRetries: DB_CONNECT_RETRIES, connectRetryDelayMs: DB_CONNECT_RETRY_DELAY_MS } = DATABASE_SETTINGS

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function authenticateWithRetry() {
  let lastError = null
  for (let attempt = 1; attempt <= DB_CONNECT_RETRIES; attempt += 1) {
    try {
      await sequelize.authenticate()
      if (attempt > 1) {
        console.log(`Database connected on attempt ${attempt}`)
      }
      return
    } catch (error) {
      lastError = error
      const retriesLeft = DB_CONNECT_RETRIES - attempt
      if (retriesLeft <= 0) break
      console.warn(
        `Database is not ready (attempt ${attempt}/${DB_CONNECT_RETRIES}), retrying in ${DB_CONNECT_RETRY_DELAY_MS}ms`
      )
      await sleep(DB_CONNECT_RETRY_DELAY_MS)
    }
  }
  throw lastError
}

export async function initDatabase() {
  await authenticateWithRetry()
  await assertMigrationsCurrent()
}
