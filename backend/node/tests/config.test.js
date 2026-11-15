import test from 'node:test'
import assert from 'node:assert/strict'

process.env.DATABASE_URL ??= 'postgresql://unused:unused@127.0.0.1:1/config_test'
const { readCoreSettings, telegramSettings, custodySettings, corsSettings, validateConfiguration, readInteger } = await import('../src/config.js')

test('malformed core settings stop startup instead of falling back to defaults', () => {
  assert.equal(readCoreSettings({}).search.max, 100)
  for (const env of [
    { SEARCH_MAX_LIMIT: 'abc' }, { SEARCH_MAX_LIMIT: '501' }, { SEARCH_DEFAULT_LIMIT: '200' },
    { MARKETPLACE_MIN_PRICE: '0.0000000001' }, { MARKETPLACE_MIN_PRICE: '5', MARKETPLACE_MAX_PRICE: '1' },
    { DB_POOL_MAX: '2' }, { HTTP_RATE_LIMIT: '0' }, { PORT: '1.5' }, { OFFERS_MAX_LIMIT: '0' },
  ]) assert.throws(() => readCoreSettings(env), /must/, JSON.stringify(env))
  const prices = readCoreSettings({ MARKETPLACE_MIN_PRICE: '0.1', MARKETPLACE_MAX_PRICE: '0.3' })
  assert.deepEqual([prices.minPriceNano, prices.maxPriceNano], [100_000_000n, 300_000_000n])
  assert.equal(readInteger({ X: ' 7 ' }, 'X', 1), 7)
  assert.equal(readCoreSettings({}).tokenTtlSeconds, 21_600)
  assert.throws(() => readCoreSettings({ AUTH_TOKEN_TTL_SECONDS: '604800' }), /AUTH_TOKEN_TTL_SECONDS/)
})

test('renamed settings stop startup instead of being ignored', async () => {
  await assert.rejects(validateConfiguration({ JWT_SECRET: 'x'.repeat(32), MARKETPLACE_MIN_PRICE_TON: '1' }),
    /MARKETPLACE_MIN_PRICE_TON was renamed to MARKETPLACE_MIN_PRICE/)
  await assert.rejects(validateConfiguration({ JWT_SECRET: 'x'.repeat(32), STORAGE_MAX_LIMIT: '50' }),
    /STORAGE_MAX_LIMIT was renamed to INVENTORY_MAX_LIMIT/)
})

test('initData age is bounded and can no longer be disabled', () => {
  assert.equal(telegramSettings({}).initDataMaxAgeSeconds, 600)
  assert.throws(() => telegramSettings({ TELEGRAM_INIT_DATA_MAX_AGE_SECONDS: '0' }))
  assert.throws(() => telegramSettings({ TELEGRAM_INIT_DATA_MAX_AGE_SECONDS: '86401' }))
})

test('optional subsystems report unconfigured, but reject malformed values', () => {
  assert.equal(custodySettings({}).configured, false)
  assert.equal(custodySettings({ CUSTODY_TELEGRAM_USER_ID: '42' }).telegramUserId, '42')
  assert.throws(() => custodySettings({ CUSTODY_TELEGRAM_USER_ID: '@keeper' }))
  assert.deepEqual(corsSettings({ NODE_ENV: 'production' }), { anyOrigin: false, origins: [] })
  assert.deepEqual(corsSettings({}), { anyOrigin: true, origins: [] })
  assert.deepEqual(corsSettings({ CORS_ALLOWED_ORIGINS: 'https://a.example, https://b.example' }).origins, ['https://a.example', 'https://b.example'])
  assert.throws(() => corsSettings({ NODE_ENV: 'production', CORS_ALLOWED_ORIGINS: '*' }))
  assert.throws(() => corsSettings({ CORS_ALLOWED_ORIGINS: 'https://a.example/path' }))
})

test('startup validation lists every problem at once', async () => {
  await assert.doesNotReject(validateConfiguration({ JWT_SECRET: 'x'.repeat(32) }))
  await assert.rejects(validateConfiguration({
    NODE_ENV: 'production', JWT_SECRET: 'short', SEARCH_MAX_LIMIT: 'x', TON_NETWORK: 'moon',
  }), error => ['JWT_SECRET', 'SEARCH_MAX_LIMIT', 'TON_NETWORK', 'TELEGRAM_BOT_TOKEN'].every(name => error.message.includes(name)))
})
