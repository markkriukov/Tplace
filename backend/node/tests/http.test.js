import test from 'node:test'
import assert from 'node:assert/strict'
import { createHttpError, publicError } from '../src/http/errors.js'
import { schemas } from '../src/http/schemas.js'
import { validator } from '../src/http/validation.js'
import { httpMetrics } from '../src/http/metrics.js'

test('lists accept cursor pagination only', () => {
  const validate = validator(schemas.inventory)
  assert.doesNotThrow(() => validate({ listed: 'true', limit: '20' }))
  assert.doesNotThrow(() => validate({ listed: 'false', limit: '20', cursor: 'opaque' }))
  assert.throws(() => validate({ limit: '20' }), { statusCode: 400 })
  for (const schema of ['inventory', 'search', 'salesHistory']) {
    assert.throws(() => validator(schemas[schema])({ listed: 'true', offset: '0' }), { statusCode: 400 })
  }
})

test('custody configuration errors retain their public status without exposing other server failures', () => {
  assert.deepEqual(publicError(createHttpError(503, 'private details', 'CUSTODY_NOT_CONFIGURED')), {
    status: 503, code: 'CUSTODY_NOT_CONFIGURED', message: 'Gift custody is not configured',
  })
  assert.deepEqual(publicError(createHttpError(503, 'password=secret')), {
    status: 500, code: 'INTERNAL_ERROR', message: 'Internal server error',
  })
  // statement_timeout cancels the query; the client may retry.
  assert.deepEqual(publicError(Object.assign(new Error('canceling statement due to statement timeout'), { original: { code: '57014' } })), {
    status: 503, code: 'DATABASE_BUSY', message: 'The service is busy. Retry shortly.',
  })
})

// These HTTP tests mock the sole database operation they exercise.
process.env.DATABASE_URL ??= 'postgresql://unused:unused@127.0.0.1:1/http_test'
process.env.ALLOW_DEV_AUTH = 'true'
const { createApp } = await import('../src/app.js')
const { User, WalletBalance, News, TonPayment } = await import('../src/db/models.js')
const { signToken, verifyToken } = await import('../src/modules/auth/auth-token.signer.js')
const { sequelize } = await import('../src/db/sequelize.js')

async function serve(t, options = {}) {
  const server = await new Promise((resolve) => { const listening = createApp(options).listen(0, '127.0.0.1', () => resolve(listening)) })
  t.after(() => { server.closeAllConnections(); return new Promise((resolve) => server.close(resolve)) })
  return `http://127.0.0.1:${server.address().port}`
}

test('valid multibyte and escaped news content fits the HTTP budget', async t => {
  const base = await serve(t)
  t.mock.method(User, 'findOne', async () => ({ telegram_id: '123', public_id: '019a0000-0000-7000-8000-000000000001', pk_user_id: 7, is_admin: true }))
  t.mock.method(News, 'create', async values => ({ ...values, pk_news_id: 1 }))
  const token = signToken({ sub: '019a0000-0000-7000-8000-000000000001', exp: Math.floor(Date.now() / 1000) + 600 })
  for (const content of ['Я'.repeat(40_000), '😀'.repeat(50_000)]) {
    const body = JSON.stringify({ title: 'Large news', content, image_url: '/images/news.png' })
      .replace(/[\uD800-\uDFFF]/g, character => `\\u${character.charCodeAt(0).toString(16)}`)
    const response = await fetch(base + '/news', { method: 'POST', body,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } })
    assert.equal(response.status, 200, await response.text())
  }
})

test('HTTP metrics group dynamic IDs by route and measure UTF-8 response bytes', async t => {
  const base = await serve(t)
  const label = 'GET /gifts/withdrawals/{id}'
  const before = httpMetrics().routes[label]?.requests ?? 0
  for (const value of ['123', '456']) {
    const response = await fetch(`${base}/gifts/withdrawals/${value}?token=private-test-value`)
    const body = await response.text()
    assert.equal(response.status, 401)
    assert.equal(Number(response.headers.get('content-length')), Buffer.byteLength(body))
  }
  const metrics = httpMetrics()
  assert.equal(metrics.routes[label].requests, before + 2)
  assert.ok(metrics.routes[label].response_bytes > 0)
  assert.equal(JSON.stringify(metrics).includes('private-test-value'), false)
  assert.equal(Object.keys(metrics.routes).some(key => key.includes('/123') || key.includes('/456')), false)
})

test('invalid bodies, queries and routes return a consistent public error', async (t) => {
  const base = await serve(t)
  for (const [path, options, status, code] of [
    ['/dev/auth/login', { method: 'POST', body: '{' }, 400, 'INVALID_JSON'],
    ['/dev/auth/login', { method: 'POST', body: 'null' }, 400, 'VALIDATION_ERROR'],
    ['/dev/auth/login', { method: 'POST', body: '{"id":1,"unexpected":true}' }, 400, 'VALIDATION_ERROR'],
    ['/dev/auth/login', { method: 'POST', body: '{"id":"9223372036854775808"}' }, 400, 'VALIDATION_ERROR'],
    ['/search?limit=501', {}, 400, 'VALIDATION_ERROR'],
    ['/news?limit=201', {}, 400, 'VALIDATION_ERROR'],
    ['/search?limit=2&limit=3', {}, 400, 'VALIDATION_ERROR'],
    ['/search?price_min=-1', {}, 400, 'VALIDATION_ERROR'],
    ['/gifts/12abc/quote', {}, 400, 'VALIDATION_ERROR'],
    ['/missing', {}, 404, 'NOT_FOUND'],
    ['/my/inventory', { method: 'POST' }, 405, 'METHOD_NOT_ALLOWED'],
  ]) {
    const response = await fetch(base + path, { headers: { 'Content-Type': 'application/json' }, ...options })
    const payload = await response.json()
    assert.equal(response.status, status, JSON.stringify(payload))
    assert.equal(payload.code, code)
    assert.equal(payload.ok, false)
    assert.equal(payload.request_id, response.headers.get('x-request-id'))
    assert.match(payload.request_id, /^[0-9a-f-]{36}$/)
  }
})

test('sales history accepts its date and price sorts through HTTP validation', async (t) => {
  const base = await serve(t)
  t.mock.method(sequelize, 'query', async () => [[]])
  for (const sort of ['soldDesc', 'soldAsc', 'priceAsc', 'priceDesc']) {
    const response = await fetch(`${base}/market/sales-history?limit=20&sort=${sort}`)
    const payload = await response.json()
    assert.equal(response.status, 200, JSON.stringify(payload))
    assert.equal(payload.ok, true)
    assert.deepEqual(payload.items, [])
  }
  assert.equal((await fetch(`${base}/market/sales-history?sort=invalid`)).status, 400)
})

test('request byte limit covers declared and chunked bodies; JSON content type is required', async (t) => {
  const base = await serve(t, { maxBodyBytes: 64 })
  const response = await fetch(base + '/dev/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: '1', username: 'x'.repeat(100) }),
  })
  assert.equal(response.status, 413)
  assert.equal((await response.json()).code, 'BODY_TOO_LARGE')
  // A streamed body has no Content-Length, so fetch sends it chunked.
  const chunks = [' '.repeat(40), ' '.repeat(40)]
  const chunked = await fetch(base + '/dev/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, duplex: 'half',
    body: new ReadableStream({ pull(controller) { const chunk = chunks.shift(); if (chunk) controller.enqueue(new TextEncoder().encode(chunk)); else controller.close() } }),
  })
  assert.equal(chunked.status, 413)
  assert.equal((await chunked.json()).code, 'BODY_TOO_LARGE')
  assert.equal((await fetch(base + '/dev/auth/login', { method: 'POST', body: '{}' })).status, 415)
  assert.equal((await fetch(base + '/health')).status, 200)
})

test('unexpected failures hide private details and expose a correlated request ID', async (t) => {
  const logs = []
  const base = await serve(t, { logger: { error: (line) => logs.push(JSON.parse(line)) } })
  const upsert = User.upsert
  User.upsert = async () => { throw new Error('SELECT secret FROM users; password=secret') }
  t.after(() => { User.upsert = upsert })
  const response = await fetch(base + '/dev/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"id":"123"}' })
  const payload = await response.json()
  assert.equal(response.status, 500)
  assert.equal(payload.error, 'Internal server error')
  assert.equal(payload.code, 'INTERNAL_ERROR')
  assert.equal(logs[0].request_id, payload.request_id)
  assert.doesNotMatch(JSON.stringify({ logs, payload }), /SELECT|password|secret/)
})

test('rate limit ignores spoofed forwarded headers and recovers after its window', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1000 })
  const base = await serve(t, { rateLimit: { maxRequests: 2 } })
  assert.equal((await fetch(base + '/health')).status, 200)
  assert.equal((await fetch(base + '/health')).status, 200)
  const response = await fetch(base + '/health', { headers: { 'X-Forwarded-For': '203.0.113.10' } })
  assert.equal(response.status, 429)
  assert.equal(response.headers.get('retry-after'), '60')
  assert.equal((await response.json()).code, 'RATE_LIMITED')
  t.mock.timers.tick(60_000)
  assert.equal((await fetch(base + '/health')).status, 200)
})

test('write and auth limits have independent bounds', async (t) => {
  const base = await serve(t, { rateLimit: { maxWrites: 3, maxAuth: 1 } })
  const post = path => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' })
  assert.equal((await post('/dev/auth/login')).status, 400)
  const limited = await post('/dev/auth/login')
  assert.equal(limited.status, 429)
  assert.equal((await limited.json()).code, 'RATE_LIMITED')
  assert.equal((await post('/news')).status, 401)
  assert.equal((await post('/news')).status, 429)
  assert.equal((await fetch(base + '/health')).status, 200)
})

test('signed-in users keep their own limits when they share one address', async (t) => {
  const base = await serve(t, { rateLimit: { maxRequests: 1, userMaxRequests: 2 } })
  const get = token => fetch(base + '/health', token ? { headers: { Authorization: `Bearer ${token}` } } : {})
  const tokenFor = (sub, exp = Math.floor(Date.now() / 1000) + 600) => signToken({ sub, exp })
  const first = tokenFor('019a0000-0000-7000-8000-000000000001')
  const second = tokenFor('019a0000-0000-7000-8000-000000000002')
  assert.equal((await get()).status, 200)
  assert.equal((await get()).status, 429)
  // Forged and expired tokens are anonymous and share the exhausted address limit.
  assert.equal((await get(first + 'x')).status, 429)
  assert.equal((await get(tokenFor('019a0000-0000-7000-8000-000000000003', 1))).status, 429)
  assert.equal((await get(first)).status, 200)
  assert.equal((await get(first)).status, 200)
  assert.equal((await get(first)).status, 429)
  assert.equal((await get(second)).status, 200)
})

test('OpenAPI is built from route definitions and input schemas', async (t) => {
  const base = await serve(t)
  const response = await fetch(base + '/openapi.json')
  assert.equal(response.status, 200)
  const spec = await response.json()
  assert.equal(spec.openapi, '3.1.0')
  const inventory = spec.paths['/my/inventory'].get
  assert.ok(inventory.parameters.some(parameter => parameter.name === 'listed'))
  assert.equal(inventory.parameters.some(parameter => parameter.name === 'offset'), false)
  const buy = spec.paths['/gifts/buy'].post
  assert.deepEqual(buy.requestBody.content['application/json'].schema.required, ['id', 'listing_id', 'expected_price_nano'])
  assert.deepEqual(buy.security, [{ bearerAuth: [] }])
  assert.deepEqual(spec.paths['/search'].get.security, [{}, { bearerAuth: [] }])
  assert.deepEqual(spec.paths['/news/{id}'].delete.parameters.map(parameter => parameter.name), ['id'])
})

test('balance polling skips payment history while the transfer overview retains a signable invoice', async (t) => {
  const base = await serve(t)
  const user = { telegram_id: '123', public_id: '019a0000-0000-7000-8000-000000000001', pk_user_id: 7 }
  t.mock.method(User, 'findOne', async () => user)
  t.mock.method(WalletBalance, 'findOrCreate', async () => { throw new Error('Existing wallet must only be read') })
  const wallets = t.mock.method(WalletBalance, 'findOne', async () => ({
    pk_wallet_balance_id: 8, fk_user_id: 7, currency_code: 'GRAM',
    available_nano: '1000000001', locked_nano: '50000000', total_nano: '1050000001',
  }))
  const payments = t.mock.method(TonPayment, 'findAll', async () => [{
    id: '9', kind: 'deposit', status: 'pending', network: '-3',
    amount_nano: '1000000001', fee_nano: '0', tx_hash: null,
    wallet_address: '0:' + '22'.repeat(32), treasury_address: '0:' + '11'.repeat(32),
    valid_until: 2000000000, memo: 'test-invoice', signed_boc: 'private-signed-message',
    created_at: new Date(),
  }])
  assert.equal((await fetch(base + '/my/wallet/balance')).status, 401)
  const headers = { Authorization: `Bearer ${signToken({ sub: user.public_id, pk_user_id: '7', exp: Math.floor(Date.now() / 1000) + 60 })}` }
  const balance = await fetch(base + '/my/wallet/balance', { headers })
  assert.equal(balance.status, 200)
  assert.deepEqual(await balance.json(), { ok: true, wallet: { currency_code: 'GRAM', available_nano: '1000000001', locked_nano: '50000000' } })
  assert.equal(payments.mock.callCount(), 0, 'A balance poll must not query TON payments')
  assert.deepEqual(wallets.mock.calls[0].arguments[0].attributes, ['currency_code', 'available_nano', 'locked_nano'])
  const overview = await fetch(base + '/my/wallet', { headers })
  assert.equal(overview.status, 200)
  const payload = await overview.json()
  assert.equal(payments.mock.callCount(), 1)
  assert.ok(payload.ton)
  const invoice = payload.payments[0]
  assert.equal(invoice.transaction.validUntil, 2000000000)
  assert.equal(invoice.transaction.from, '0:' + '22'.repeat(32))
  assert.equal(invoice.transaction.messages[0].amount, '1000000001')
  assert.ok(invoice.transaction.messages[0].payload)
  assert.equal(invoice.created_at, undefined)
  assert.equal(invoice.signed_boc, undefined)
  assert.ok(!payments.mock.calls[0].arguments[0].attributes.includes('signed_boc'))
})

test('compact login still issues a valid token and exposes admin capability without profile data', async (t) => {
  const base = await serve(t)
  t.mock.method(User, 'upsert', async () => [{ telegram_id: '123', public_id: '019a0000-0000-7000-8000-000000000001', pk_user_id: 7, username: 'private-name', first_name: 'Private', is_admin: true }])
  const response = await fetch(base + '/dev/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"id":"123"}',
  })
  assert.equal(response.status, 200)
  const payload = await response.json()
  assert.deepEqual(payload.user, { is_admin: true })
  assert.equal(payload.auth_source, 'dev')
  assert.equal(verifyToken(payload.token).sub, '019a0000-0000-7000-8000-000000000001')
})

test('a token stops working once the user token version is incremented', async t => {
  const base = await serve(t)
  const sub = '019a0000-0000-7000-8000-000000000001'
  let tokenVersion = 0
  t.mock.method(User, 'findOne', async () => ({ telegram_id: '123', public_id: sub, pk_user_id: 7, is_admin: true, token_version: tokenVersion }))
  const exp = Math.floor(Date.now() / 1000) + 600
  const unversioned = signToken({ sub, exp })
  const current = signToken({ sub, exp, ver: 0 })
  const operations = token => fetch(base + '/admin/operations', { headers: { Authorization: `Bearer ${token}` } })
  t.mock.method(sequelize, 'query', async () => [[{ overdue: '0' }]])
  assert.equal((await operations(current)).status, 200)
  assert.equal((await operations(unversioned)).status, 401)
  tokenVersion = 1
  for (const token of [current, unversioned]) {
    const response = await operations(token)
    assert.equal(response.status, 401)
    assert.equal((await response.json()).code, 'UNAUTHORIZED')
  }
  assert.equal((await operations(signToken({ sub, exp, ver: 1 }))).status, 200)
})

test('CORS answers only configured origins and never echoes others', async (t) => {
  const listed = await serve(t, { cors: { anyOrigin: false, origins: ['https://admin.example.com'] } })
  const headersFor = async (base, origin, method = 'GET') =>
    (await fetch(base + '/health', { method, headers: origin ? { Origin: origin, 'Access-Control-Request-Method': 'POST' } : {} })).headers
  assert.equal((await headersFor(listed, 'https://admin.example.com')).get('access-control-allow-origin'), 'https://admin.example.com')
  const evil = await headersFor(listed, 'https://evil.example.com')
  assert.equal(evil.get('access-control-allow-origin'), null)
  assert.equal(evil.get('vary'), 'Origin')
  assert.equal((await headersFor(listed, null)).get('access-control-allow-origin'), null)
  const preflight = await fetch(listed + '/gifts/buy', { method: 'OPTIONS', headers: { Origin: 'https://admin.example.com', 'Access-Control-Request-Method': 'POST' } })
  assert.equal(preflight.status, 204)
  assert.equal(preflight.headers.get('access-control-allow-headers'), 'Content-Type,Authorization')
  const open = await serve(t, { cors: { anyOrigin: true, origins: [] } })
  assert.equal((await headersFor(open, 'https://any.example.com')).get('access-control-allow-origin'), '*')
})
