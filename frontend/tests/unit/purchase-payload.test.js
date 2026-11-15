import test from 'node:test'
import assert from 'node:assert/strict'
import { purchasePayload } from '../../src/features/gifts/lib/gift-purchase-payload.js'
import { buyGift } from '../../src/features/gifts/api/gifts.api.js'

test('purchase submits the original quote rather than a rounded display price', () => {
  assert.deepEqual(purchasePayload({ id: 12, listing_id: 25, price: '1.23', price_nano: '1234567891' }), {
    id: 12, listing_id: 25, expected_price_nano: '1234567891',
  })
})

test('legacy cart entries without a quote require a refresh', () => {
  assert.throws(() => purchasePayload({ id: 12, price: '5' }), { code: 'LISTING_CHANGED' })
})

test('lost purchase response retries the same confirmed quote exactly once', async (t) => {
  const body = purchasePayload({ id: 12, listing_id: 25, price_nano: '1234567891' })
  const requests = []
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    requests.push(options.body)
    if (requests.length === 1) throw new TypeError('Connection lost after commit')
    return new Response(JSON.stringify({ ok: true, wallet: { available_nano: '0' } }))
  })
  assert.equal((await buyGift(body)).ok, true)
  assert.deepEqual(requests, [JSON.stringify(body), JSON.stringify(body)])
  assert.deepEqual(purchasePayload({ ...body, price_nano: body.expected_price_nano }), body)
})

test('purchase retries are bounded and explicit cancellation is respected', async (t) => {
  const body = purchasePayload({ id: 12, listing_id: 25, price_nano: '1' })
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new TypeError('Offline') })
  await assert.rejects(() => buyGift(body), /Offline/)
  assert.equal(fetch.mock.callCount(), 2)
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(() => buyGift(body, { signal: controller.signal }), /Offline/)
  assert.equal(fetch.mock.callCount(), 3)
})

test('purchase recovers a response truncated after successful HTTP headers', async (t) => {
  const body = purchasePayload({ id: 12, listing_id: 25, price_nano: '1' })
  let calls = 0
  t.mock.method(globalThis, 'fetch', async () => {
    calls += 1
    return new Response(calls === 1 ? '{"ok":' : '{"ok":true}')
  })
  assert.equal((await buyGift(body)).data.ok, true)
  assert.equal(calls, 2)
})
