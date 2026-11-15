import { parseAmountToNano } from './modules/wallet/wallet-money.utils.js'
import { authSettings } from './security.js'

// Configuration has two shapes:
// - core settings below are read once at import and exported as constants;
// - optional subsystems (auth, Telegram, custody, TON, CORS) expose
//   `xxxSettings(env = process.env)` and are read when used.
// validateConfiguration() runs every reader at startup, so a malformed value
// stops the process instead of silently falling back to a default.

/** Settings renamed without a fallback: a stale name must not be ignored silently. */
const renamedSettings = {
  MARKETPLACE_MIN_PRICE_TON: 'MARKETPLACE_MIN_PRICE',
  MARKETPLACE_MAX_PRICE_TON: 'MARKETPLACE_MAX_PRICE',
  DEV_JWT_EXPIRES_IN_SECONDS: 'AUTH_TOKEN_TTL_SECONDS',
  GIFT_SYNC_ENABLED: 'CUSTODY_RECONCILE_ALERTS',
  SYNC_ALERT_AFTER_SECONDS: 'CUSTODY_RECONCILE_ALERT_AFTER_SECONDS',
  STORAGE_MAX_LIMIT: 'INVENTORY_MAX_LIMIT',
  STORAGE_DEFAULT_LIMIT: 'INVENTORY_DEFAULT_LIMIT',
}

/** The gift withdrawal fee a client confirms, reserved from the GRAM balance. */
export const GIFT_WITHDRAWAL_FEE_NANO = 250_000_000n

/** @param {NodeJS.ProcessEnv} env @param {string} name @param {number} fallback @param {{min?: number, max?: number}} [bounds] */
export function readInteger(env, name, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = env[name]?.trim()
  if (!raw) return fallback
  const value = Number(raw)
  if (!/^-?\d+$/.test(raw) || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`)
  }
  return value
}

/** @param {NodeJS.ProcessEnv} env @param {string} name @param {string} fallback */
function readGramAmount(env, name, fallback) {
  const nano = parseAmountToNano(env[name]?.trim() || fallback)
  if (nano == null) throw new Error(`${name} must be a positive amount with at most 9 decimals`)
  return nano
}

export function readMarketplaceFeeBps(env = process.env) {
  const raw = env.MARKETPLACE_FEE_BPS ?? '50'
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) > 10_000) {
    throw new Error('MARKETPLACE_FEE_BPS must be an integer between 0 and 10000')
  }
  return Number(raw)
}

/** @param {NodeJS.ProcessEnv} [env] */
export function readCoreSettings(env = process.env) {
  const minPriceNano = readGramAmount(env, 'MARKETPLACE_MIN_PRICE', '0.5')
  const maxPriceNano = readGramAmount(env, 'MARKETPLACE_MAX_PRICE', '100000')
  if (maxPriceNano < minPriceNano) throw new Error('MARKETPLACE_MAX_PRICE must not be below MARKETPLACE_MIN_PRICE')
  /** @param {string} prefix @param {number} defaultLimit @param {number} maxLimit */
  const limits = (prefix, defaultLimit, maxLimit) => {
    const max = readInteger(env, `${prefix}_MAX_LIMIT`, maxLimit, { min: 1, max: 500 })
    const fallback = readInteger(env, `${prefix}_DEFAULT_LIMIT`, Math.min(defaultLimit, max), { min: 1, max })
    return { max, fallback }
  }
  return {
    port: readInteger(env, 'PORT', 4000, { min: 1, max: 65_535 }),
    // The Mini App signs in again on each launch, so tokens need not outlive a session.
    tokenTtlSeconds: readInteger(env, 'AUTH_TOKEN_TTL_SECONDS', 21_600, { min: 60, max: 86_400 }),
    marketplaceFeeBps: readMarketplaceFeeBps(env),
    minPriceNano, maxPriceNano,
    search: limits('SEARCH', 20, 100),
    inventory: limits('INVENTORY', 20, 100),
    salesHistory: limits('SALES_HISTORY', 50, 200),
    offers: limits('OFFERS', 50, 200),
    walletHistory: limits('WALLET_HISTORY', 25, 100),
    news: limits('NEWS', 20, 100),
    filtersCacheTtlMs: readInteger(env, 'FILTERS_CATALOG_CACHE_TTL_MS', 30_000, { min: 1 }),
    filtersStaticCacheTtlMs: readInteger(env, 'FILTERS_STATIC_CACHE_TTL_MS', 60_000, { min: 1 }),
    rateLimit: {
      maxRequests: readInteger(env, 'HTTP_RATE_LIMIT', 300, { min: 1 }),
      maxWrites: readInteger(env, 'HTTP_WRITE_RATE_LIMIT', 120, { min: 1 }),
      maxAuth: readInteger(env, 'HTTP_AUTH_RATE_LIMIT', 30, { min: 1 }),
      userMaxRequests: readInteger(env, 'HTTP_USER_RATE_LIMIT', 300, { min: 1 }),
      userMaxWrites: readInteger(env, 'HTTP_USER_WRITE_RATE_LIMIT', 120, { min: 1 }),
    },
    database: {
      poolMax: readInteger(env, 'DB_POOL_MAX', 15, { min: 3, max: 200 }),
      slowQueryMs: readInteger(env, 'DB_SLOW_QUERY_MS', 0),
      connectRetries: readInteger(env, 'DB_CONNECT_RETRIES', 30, { min: 1 }),
      connectRetryDelayMs: readInteger(env, 'DB_CONNECT_RETRY_DELAY_MS', 2000),
      // Server-side limits per connection; 0 disables one. Migrations, catalog
      // sync and the workers' lock transactions lift them where they must.
      statementTimeoutMs: readInteger(env, 'DB_STATEMENT_TIMEOUT_MS', 10_000),
      lockTimeoutMs: readInteger(env, 'DB_LOCK_TIMEOUT_MS', 5_000),
      idleInTransactionTimeoutMs: readInteger(env, 'DB_IDLE_IN_TRANSACTION_TIMEOUT_MS', 30_000),
    },
  }
}

const core = readCoreSettings()

export const PORT = core.port
export const APP_CURRENCY = 'GRAM'
export const GIFT_IMAGES = [
  '/gifts/crystal-fox.svg',
  '/gifts/cyber-bloom.svg',
  '/gifts/lunar-toy.svg',
  '/gifts/signal-orb.svg',
]
export const AUTH_TOKEN_TTL_SECONDS = core.tokenTtlSeconds
export const MARKETPLACE_FEE_BPS = core.marketplaceFeeBps
export const MARKETPLACE_MIN_PRICE_NANO = core.minPriceNano
export const MARKETPLACE_MAX_PRICE_NANO = core.maxPriceNano
export const SEARCH_LIMITS = core.search
export const INVENTORY_LIMITS = core.inventory
export const SALES_HISTORY_LIMITS = core.salesHistory
export const OFFERS_LIMITS = core.offers
export const WALLET_HISTORY_LIMITS = core.walletHistory
export const NEWS_LIMITS = core.news
export const FILTERS_CATALOG_CACHE_TTL_MS = core.filtersCacheTtlMs
export const FILTERS_STATIC_CACHE_TTL_MS = core.filtersStaticCacheTtlMs
export const HTTP_RATE_LIMITS = core.rateLimit
export const DATABASE_SETTINGS = core.database

/** @param {NodeJS.ProcessEnv} [env] */
export function telegramSettings(env = process.env) {
  return {
    botToken: env.TELEGRAM_BOT_TOKEN?.trim() || '',
    // initData is exchanged for a token as soon as the Mini App opens; a long
    // window only widens replay of an intercepted initData string.
    initDataMaxAgeSeconds: readInteger(env, 'TELEGRAM_INIT_DATA_MAX_AGE_SECONDS', 600, { min: 60, max: 86_400 }),
  }
}

/** @param {NodeJS.ProcessEnv} [env] */
export function custodySettings(env = process.env) {
  const telegramUserId = env.CUSTODY_TELEGRAM_USER_ID?.trim() || ''
  if (telegramUserId && (!/^[1-9][0-9]{0,18}$/.test(telegramUserId) || BigInt(telegramUserId) > 9223372036854775807n)) {
    throw new Error('CUSTODY_TELEGRAM_USER_ID must be a numeric Telegram user ID')
  }
  return {
    configured: Boolean(telegramUserId),
    telegramUserId,
    maxAgeSeconds: readInteger(env, 'CUSTODY_MAX_AGE_SECONDS', 7200, { min: 1 }),
  }
}

/** Origins allowed to call the API from a browser. Production serves the API
 * from the frontend origin through Nginx and needs none by default.
 * @param {NodeJS.ProcessEnv} [env] */
export function corsSettings(env = process.env) {
  const raw = env.CORS_ALLOWED_ORIGINS?.trim()
  if (!raw) return { anyOrigin: env.NODE_ENV !== 'production', origins: [] }
  if (raw === '*') {
    if (env.NODE_ENV === 'production') throw new Error('CORS_ALLOWED_ORIGINS=* is not allowed in production')
    return { anyOrigin: true, origins: [] }
  }
  const origins = raw.split(',').map(value => value.trim()).filter(Boolean)
  for (const origin of origins) {
    let parsed
    try { parsed = new URL(origin) } catch { throw new Error(`CORS_ALLOWED_ORIGINS contains an invalid origin: ${origin}`) }
    if (parsed.origin !== origin) throw new Error(`CORS_ALLOWED_ORIGINS must list bare origins such as https://example.com: ${origin}`)
  }
  return { anyOrigin: false, origins }
}

/** Run every settings reader and report all problems at once.
 * @param {NodeJS.ProcessEnv} [env] */
export async function validateConfiguration(env = process.env) {
  const { getTonConfig } = await import('./modules/wallet/ton/ton.config.js')
  const problems = Object.entries(renamedSettings)
    .filter(([name]) => env[name] !== undefined)
    .map(([name, replacement]) => `${name} was renamed to ${replacement}`)
  const readers = [readCoreSettings, authSettings, telegramSettings, custodySettings, corsSettings, getTonConfig]
  for (const read of readers) {
    try { read(env) } catch (error) { problems.push(error instanceof Error ? error.message : String(error)) }
  }
  if (env.NODE_ENV === 'production' && !env.TELEGRAM_BOT_TOKEN?.trim()) problems.push('TELEGRAM_BOT_TOKEN is required in production')
  if (problems.length) throw new Error(`Invalid configuration:\n- ${problems.join('\n- ')}`)
}
