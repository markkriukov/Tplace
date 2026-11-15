import test from 'node:test'
import assert from 'node:assert/strict'
import { createMarketActions } from '../../src/app/lib/market-actions.js'
import { lockBodyScroll } from '../../src/shared/lib/body-scroll-lock.js'
import { request } from '../../src/shared/api/client.js'
import { readLocalStorage, writeLocalStorage } from '../../src/shared/lib/storage.js'

test('purchase synchronizes catalog, cart and inventory freshness', () => {
  const state = { catalog: [{ id: 1 }, { id: 2 }], inventory: [], cart: [1, 2], loaded: true }
  const setter = (key) => (value) => {
    state[key] = typeof value === 'function' ? value(state[key]) : value
  }
  const actions = createMarketActions({
    setCatalogGifts: setter('catalog'),
    setInventoryGifts: setter('inventory'),
    setCartIds: setter('cart'),
    refreshInventory: () => { state.refreshes = (state.refreshes ?? 0) + 1 },
    refreshCatalog: () => {},
  })
  actions.giftPurchased(1)
  assert.deepEqual(state.catalog, [{ id: 2 }])
  assert.deepEqual(state.cart, [2])
  assert.equal(state.loaded, true)
  actions.giftListed({ gift: { id: 3 }, mode: 'list', price: 5 }, 'inventory')
  assert.equal(state.catalog.at(-1).isOwnedByCurrentUser, true)
  actions.giftListed({ gift: { id: 3 }, mode: 'edit', price: 6, listing: { id: 77, price_nano: '6000000000' } }, 'catalog')
  assert.equal(state.catalog.at(-1).listing_id, 77)
  assert.equal(state.catalog.at(-1).price_nano, '6000000000')
  actions.saleCanceled(3)
  assert.deepEqual(state.catalog, [{ id: 2 }])
  assert.equal(state.refreshes, 4)
  actions.cartPurchased([2])
  assert.equal(state.refreshes, 5)
})

test('overlapping dialogs restore scrolling only after the final close', () => {
  const body = { style: { overflowY: 'scroll' } }
  const closeFirst = lockBodyScroll(body)
  const closeSecond = lockBodyScroll(body)
  closeFirst()
  closeFirst()
  assert.equal(body.style.overflowY, 'hidden')
  closeSecond()
  assert.equal(body.style.overflowY, 'scroll')
})

test('unavailable storage getters and methods do not break reads, writes or removal', t => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor)
    else delete globalThis.localStorage
  })
  for (const unavailable of ['property', 'methods']) {
    const denied = () => { throw new Error('Storage is blocked') }
    Object.defineProperty(globalThis, 'localStorage', { configurable: true,
      get: unavailable === 'property' ? denied : () => ({ getItem: denied, setItem: denied, removeItem: denied }) })
    assert.equal(readLocalStorage('language'), null)
    assert.doesNotThrow(() => writeLocalStorage('language', 'uk'))
    assert.doesNotThrow(() => writeLocalStorage('language', null))
  }
})

test('API client forwards auth, JSON and cancellation and retains error details', async (t) => {
  const controller = new AbortController()
  let forwardedSignal
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'http://localhost/api/gifts/buy')
    assert.equal(options.headers.Authorization, 'Bearer test-token')
    forwardedSignal = options.signal
    assert.equal(forwardedSignal.aborted, false)
    assert.equal(options.body, '{"id":5}')
    return new Response(JSON.stringify({ ok: false, error: 'Gift is not listed' }), { status: 409 })
  })
  const result = await request('/gifts/buy', {
    token: 'test-token',
    method: 'POST',
    body: { id: 5 },
    signal: controller.signal,
  })
  assert.equal(result.ok, false)
  assert.equal(result.error.status, 409)
  assert.equal(result.error.message, 'Gift is not listed')
  controller.abort()
  assert.equal(forwardedSignal.aborted, true)
})

test('API timeout includes reading the response body and caller cancellation propagates', async t => {
  t.mock.method(globalThis, 'fetch', async (_url, { signal }) => ({ ok: true, status: 200,
    json: () => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })),
  }))
  await Promise.all([
    assert.rejects(request('/search', { timeoutMs: 5 }), { name: 'TimeoutError' }),
    new Promise(resolve => setTimeout(resolve, 20)),
  ])
  const controller = new AbortController()
  const pending = request('/search', { signal: controller.signal })
  await Promise.resolve()
  controller.abort()
  await assert.rejects(pending, { name: 'AbortError' })
})

test('body transport failures propagate while malformed JSON remains inspectable', async t => {
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, status: 200,
    json: async () => { throw new TypeError('Connection lost') },
  }))
  await assert.rejects(request('/search'), /Connection lost/)
  t.mock.method(globalThis, 'fetch', async () => new Response('{', { status: 200 }))
  assert.equal((await request('/search')).data, null)
})
