import test from 'node:test'
import assert from 'node:assert/strict'

process.env.DATABASE_URL ??= 'postgresql://unused:unused@127.0.0.1:1/cache_test'
const { sequelize } = await import('../src/db/sequelize.js')
const { Collection, Background, GiftSymbol, Gift } = await import('../src/db/models.js')
const { listGift, cancelListing } = await import('../src/modules/gifts/gifts.service.js')
const { loadCachedFiltersCatalogPayload, invalidateFiltersCatalogCache, loadCollectionLookup } = await import('../src/modules/catalog/filters/filters.service.js')
const rows = quantity => [[{ kind: 'collection', key: 'Example', quantity }]]

const resetCaches = () => invalidateFiltersCatalogCache({ catalog: true })

function mockCatalog(t) {
  resetCaches()
  t.after(resetCaches)
  t.mock.method(Collection, 'findAll', async () => [{ pk_collection_id: 1, short_name: 'Example' }])
  t.mock.method(Background, 'findAll', async () => [])
  t.mock.method(GiftSymbol, 'findAll', async () => [])
}

test('concurrent filter requests share one build; invalidation cannot resurrect an older build', async t => {
  mockCatalog(t)
  let finishOld
  const oldRows = new Promise(resolve => { finishOld = resolve })
  let calls = 0
  t.mock.method(sequelize, 'query', () => ++calls === 1 ? oldRows : Promise.resolve(rows(2)))
  const requests = Array.from({ length: 20 }, () => loadCachedFiltersCatalogPayload())
  await Promise.resolve()
  assert.equal(calls, 1)
  invalidateFiltersCatalogCache()
  const fresh = await loadCachedFiltersCatalogPayload()
  assert.equal(fresh.collections[0].on_sale_count, 2)
  finishOld(rows(1))
  const previous = await Promise.all(requests)
  assert.ok(previous.every(payload => payload.collections[0].on_sale_count === 1))
  assert.equal((await loadCachedFiltersCatalogPayload()).collections[0].on_sale_count, 2)
  assert.equal(calls, 2)
})

test('a failed shared build can be retried', async t => {
  mockCatalog(t)
  let calls = 0
  t.mock.method(sequelize, 'query', async () => {
    if (++calls === 1) throw new Error('Temporary database failure')
    return rows(3)
  })
  const failed = await Promise.allSettled([loadCachedFiltersCatalogPayload(), loadCachedFiltersCatalogPayload()])
  assert.ok(failed.every(result => result.status === 'rejected'))
  assert.equal(calls, 1)
  assert.equal((await loadCachedFiltersCatalogPayload()).collections[0].on_sale_count, 3)
  assert.equal(calls, 2)
})

test('failed listing and cancellation retain the cached filter catalog', async t => {
  mockCatalog(t)
  const query = t.mock.method(sequelize, 'query', async () => rows(1))
  t.mock.method(sequelize, 'transaction', async task => task({ LOCK: { UPDATE: 'UPDATE' } }))
  t.mock.method(Gift, 'findOne', async () => null)
  const cached = await loadCachedFiltersCatalogPayload()
  for (const action of [listGift, cancelListing]) {
    await assert.rejects(action({ currentUser: { pk_user_id: 1 }, body: { id: '019a0000-0000-7000-8000-000000000001', price: '5' } }),
      { statusCode: 404, code: 'NOT_FOUND' })
    assert.equal(await loadCachedFiltersCatalogPayload(), cached)
  }
  assert.equal(query.mock.callCount(), 1)
})

test('a trade rebuilds on-sale counts from cached catalog rows', async t => {
  mockCatalog(t)
  let count = 0
  const query = t.mock.method(sequelize, 'query', async () => rows(++count))
  assert.equal((await loadCachedFiltersCatalogPayload()).collections[0].on_sale_count, 1)
  invalidateFiltersCatalogCache()
  assert.equal((await loadCachedFiltersCatalogPayload()).collections[0].on_sale_count, 2)
  assert.equal(query.mock.callCount(), 2)
  assert.equal(Collection.findAll.mock.callCount(), 1)
})

test('collection lookup is cached, kept across trades and resolves IDs before names', async t => {
  resetCaches()
  t.after(resetCaches)
  const findAll = t.mock.method(Collection, 'findAll', async () => [
    { pk_collection_id: 1, short_name: 'CrystalFox', display_name: 'Crystal Fox', collection_regular_id: '55' },
    { pk_collection_id: 2, short_name: 'Crystal Fox', display_name: 'Other', collection_regular_id: null },
  ])
  const [first, second] = await Promise.all([loadCollectionLookup(), loadCollectionLookup()])
  assert.equal(first, second)
  assert.equal(findAll.mock.callCount(), 1)
  assert.equal(first.byRegularId.get('55'), 1)
  // An exact short name wins over another collection's display name and over aliases.
  assert.equal(first.byName.get('Crystal Fox'), 2)
  assert.equal(first.byAlias.get('crystalfox'), 1)
  invalidateFiltersCatalogCache()
  assert.equal(await loadCollectionLookup(), first)
  assert.equal(findAll.mock.callCount(), 1)
  resetCaches()
  await loadCollectionLookup()
  assert.equal(findAll.mock.callCount(), 2)
})
