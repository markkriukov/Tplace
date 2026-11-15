import { sortTagOptions } from '../../src/features/filters/lib/filter-option-utils.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { loadFilterCatalog, FILTER_CATALOG_TTL_MS } from '../../src/features/filters/lib/filter-catalog-cache.js'
import { notifyMarketChanged } from '../../src/shared/api/market-events.js'
import { request } from '../../src/shared/api/client.js'
import { mapFilterCatalog } from '../../src/features/filters/lib/filter-catalog-mapping.js'

const payload = count => ({ ok: true, collections: [{ id: 1, display_name: 'Bunny', short_name: 'bunny', on_sale_count: count }] })
const response = count => Response.json(payload(count))

test('filter mapping preserves unknown counts and ignores malformed or hidden entries', () => {
  const catalog = mapFilterCatalog({
    collections: [null, {}, { id: 1, short_name: 'telegramgifts', display_name: 'Telegram Gifts' },
      { id: 2, short_name: ' bunny ', display_name: ' Bunny ', collection_regular_id: '42', on_sale_count: null }],
    models: [{ id: 3, name: ' Gold ', rarity: '12,5', on_sale_count: '0', url: ' /gold.png ' }],
    backgrounds: [{ id: 4, name: 'Blue', on_sale_count: 'unknown', center_color: 255 }],
  })
  assert.equal(catalog.collections.length, 1)
  assert.equal(catalog.collections[0].name, 'Bunny')
  assert.equal(catalog.collections[0].regularId, '42')
  assert.equal(catalog.collections[0].onSaleCount, null)
  assert.deepEqual(catalog.models[0], { id: 3, name: 'Gold', rarity: 12.5, onSaleCount: 0, url: '/gold.png' })
  assert.equal(catalog.backgrounds[0].onSaleCount, null)
  assert.equal(catalog.backgrounds[0].centerColor, 255)
  assert.deepEqual(catalog.symbols, [])
})

test('filter requests share results until expiry; collections have separate cache entries', async t => {
  notifyMarketChanged()
  let now = 1000
  let calls = 0
  t.mock.method(Date, 'now', () => now)
  t.mock.method(globalThis, 'fetch', async () => response(++calls))
  const first = loadFilterCatalog()
  assert.equal(loadFilterCatalog(), first)
  assert.equal((await first).collections[0].onSaleCount, 1)
  assert.equal((await loadFilterCatalog()).collections[0].onSaleCount, 1)
  assert.equal((await loadFilterCatalog({ shortName: 'bunny', regularId: '42' })).collections[0].onSaleCount, 2)
  now += FILTER_CATALOG_TTL_MS
  assert.equal((await loadFilterCatalog()).collections[0].onSaleCount, 3)
  assert.equal(calls, 3)
})

test('failed filter request can be retried immediately', async t => {
  notifyMarketChanged()
  let calls = 0
  t.mock.method(globalThis, 'fetch', async () => ++calls === 1
    ? Response.json({ ok: false }, { status: 503 }) : response(2))
  await assert.rejects(loadFilterCatalog(), /Filters unavailable/)
  assert.equal((await loadFilterCatalog()).collections[0].onSaleCount, 2)
})

test('invalidation cancels stale responses without removing the new cache entry', async t => {
  notifyMarketChanged()
  let release
  let oldSignal
  let calls = 0
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    if (++calls > 1) return response(2)
    oldSignal = options.signal
    return new Promise(resolve => { release = () => resolve(response(1)) })
  })
  const old = loadFilterCatalog()
  await Promise.resolve()
  notifyMarketChanged()
  assert.equal(oldSignal.aborted, true)
  const fresh = loadFilterCatalog()
  assert.equal((await fresh).collections[0].onSaleCount, 2)
  const rejected = assert.rejects(old, { name: 'AbortError' })
  release()
  await rejected
  assert.equal(loadFilterCatalog(), fresh)
  assert.equal(calls, 2)
})

test('successful market mutations invalidate filters; reads and failed mutations retain them', async t => {
  notifyMarketChanged()
  let count = 1
  let success = true
  t.mock.method(globalThis, 'fetch', async url => url.endsWith('/filters/catalog')
    ? response(count) : Response.json({ ok: success }, { status: success ? 200 : 409 }))
  const first = loadFilterCatalog()
  await first
  await request('/gifts/buy')
  assert.equal(loadFilterCatalog(), first)
  success = false
  await request('/gifts/buy', { method: 'POST', body: { id: 1 } })
  assert.equal(loadFilterCatalog(), first)
  success = true
  for (const path of ['/gifts/list', '/gifts/buy', '/gifts/cancel', '/gifts/withdraw', '/offers/42/accept']) {
    count++
    await request(path, { method: 'POST', body: { id: 1 } })
    assert.equal((await loadFilterCatalog()).collections[0].onSaleCount, count)
  }
})

test('textual rarity survives mapping and unknown rarity sorts last in either direction', () => {
  const catalog = mapFilterCatalog({ models: [{ id: 1, name: 'Gold', rarity: 'rare' }] })
  assert.equal(catalog.models[0].rarity, 'rare')
  const rows = [{ value: 'Unknown', rarity: null }, { value: 'Epic', rarity: 'epic' },
    { value: 'Rare', rarity: 'rare' }, { value: 'Numeric', rarity: '2%' }]
  for (const direction of ['asc', 'desc']) {
    const result = sortTagOptions(rows, '', { column: 'rarity', direction })
    assert.equal(result.at(-1).value, 'Unknown')
    assert.equal(result[0].value, direction === 'asc' ? 'Numeric' : 'Rare')
  }
})
