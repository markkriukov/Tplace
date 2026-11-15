import test from 'node:test'
import assert from 'node:assert/strict'
import { loadChangesCatalog, parseChangesCatalog } from '../src/modules/catalog/sync/sync-changes.client.js'

const backdrops = [{ name: 'Black', centerColor: 0, edgeColor: 921359, patternColor: 7104616, textColor: 16777215 }]
const gift = {
  gift: { id: '6005797617768858105', name: 'Artisan Brick' },
  models: [{ name: 'Grand Piano & Gold', rarity: 1.5 }],
  backdrops: [{ name: 'Black', rarity: 1.2 }],
  symbols: [{ name: 'Thor Hammer', rarity: 0.2 }],
}
const otherGift = {
  gift: { id: '5913351908466098791', name: 'Mirage Lamp' },
  models: [{ name: 'Grand Piano & Gold', rarity: 2 }],
  backdrops: [{ name: 'Black', rarity: 2 }],
  symbols: [{ name: 'Thor Hammer', rarity: 0.5 }],
}
const snapshot = () => parseChangesCatalog([structuredClone(gift), structuredClone(otherGift)], backdrops)

test('Changes catalog preserves IDs, encodes images, and keeps collection-specific rarities', () => {
  const catalog = snapshot()
  assert.deepEqual(catalog.collections[0], {
    collection_regular_id: '6005797617768858105', short_name: 'ArtisanBrick', display_name: 'Artisan Brick',
    photo_url: 'https://api.changes.tg/original/6005797617768858105.png',
  })
  assert.deepEqual(catalog.models.map((row) => row.rarity), ['15', '20'])
  assert.equal(catalog.models[0].url, 'https://api.changes.tg/model/6005797617768858105/Grand%20Piano%20%26%20Gold.png')
  assert.equal(catalog.backgrounds.length, 1)
  assert.equal(catalog.backgrounds[0].center_color, 0)
  assert.equal(catalog.backgrounds[0].text_color, 16777215)
  assert.equal(catalog.symbols.length, 1)
  assert.equal(catalog.symbols[0].url, 'https://api.changes.tg/symbol/6005797617768858105/Thor%20Hammer.png')
  assert.deepEqual(catalog.collectionBackgroundLinks.map((row) => row.rarity), ['12', '20'])
  assert.deepEqual(catalog.collectionSymbolLinks.map((row) => row.rarity), ['2', '5'])
})

test('Changes catalog rejects incomplete or corrupt snapshots before writing them', () => {
  for (const mutate of [
    (row) => { row.gift.id = Number(row.gift.id) },
    (row) => { row.models = [] },
    (row) => { delete row.symbols },
    (row) => { row.models[0].rarity = null },
    (row) => { row.models[0].rarity = -1 },
    (row) => { row.models.push(row.models[0]) },
    (row) => { row.backdrops[0].name = 'Unknown' },
  ]) {
    const invalid = structuredClone(gift)
    mutate(invalid)
    assert.throws(() => parseChangesCatalog([invalid], backdrops), /Changes API/)
  }
  assert.throws(() => parseChangesCatalog([gift, gift], backdrops), /duplicate/)
  assert.throws(() => parseChangesCatalog([gift], [{ ...backdrops[0], edgeColor: null }]), /edgeColor/)
  assert.throws(() => parseChangesCatalog([], backdrops), /gift details/)
})

test('Changes loader requests N+2 JSON resources without downloading images', async () => {
  const requested = []
  const payloads = new Map([
    ['/gifts', ['Artisan Brick', 'Mirage Lamp']], ['/backdrops', backdrops],
    ['/gift/Artisan%20Brick', gift], ['/gift/Mirage%20Lamp', otherGift],
  ])
  const catalog = await loadChangesCatalog({ fetchImpl: async (url, options) => {
    assert.ok(options.signal instanceof AbortSignal)
    const path = new URL(url).pathname
    requested.push(path)
    assert.ok(payloads.has(path), `Unexpected request: ${url}`)
    return Response.json(payloads.get(path))
  } })
  assert.deepEqual(catalog, snapshot())
  assert.deepEqual(requested.sort(), [...payloads.keys()].sort())
})

test('Changes loader retries transient errors but rejects permanent errors', async () => {
  let calls = 0
  await assert.rejects(loadChangesCatalog({ fetchImpl: async () => {
    calls += 1
    return new Response('Unavailable', { status: calls === 1 ? 503 : 404 })
  } }), /HTTP 404/)
  assert.equal(calls, 2)
  await assert.rejects(loadChangesCatalog({ fetchImpl: async () => Response.json({ error: 'invalid' }) }), /gifts/)
})

test('catalog persists once, serializes initializers, refreshes explicitly and rolls back failures',
  { skip: !process.env.TEST_DATABASE_URL }, async (t) => {
    const url = new URL(process.env.TEST_DATABASE_URL)
    assert.match(url.pathname, /_test$/, 'Use test database credentials')
    const { Sequelize } = await import('sequelize')
    url.pathname = '/postgres'
    const admin = new Sequelize(url.toString(), { logging: false })
    const databaseName = `tplace_catalog_${process.pid}_${Date.now()}_test`
    await admin.query(`CREATE DATABASE "${databaseName}"`)
    url.pathname = `/${databaseName}`
    process.env.DATABASE_URL = url.toString()
    const { sequelize } = await import('../src/db/sequelize.js')
    t.after(async () => {
      await sequelize.close()
      await admin.query(`DROP DATABASE "${databaseName}"`)
      await admin.close()
    })
    const { migrateDatabase } = await import('../src/db/migrations.js')
    const { syncChangesCatalog } = await import('../src/modules/catalog/sync/sync.service.js')
    const { Collection, GiftModel, Background, GiftSymbol, CollectionBackground, CollectionSymbol, Gift } = await import('../src/db/models.js')
    await migrateDatabase()

    let downloads = 0
    const loadCatalog = async () => { downloads += 1; return snapshot() }
    const marker = async () => (await sequelize.query('SELECT * FROM catalog_sync_state'))[0]
    await assert.rejects(syncChangesCatalog({ loadCatalog: async () => { throw new Error('API offline') } }), /API offline/)
    assert.deepEqual(await marker(), [])
    assert.equal(await Collection.count(), 0)

    // Simulate a database populated by the old importer/Telegram worker, with existing gifts.
    const collection = await Collection.create({ short_name: 'artisanbrick', display_name: 'Old name' })
    const model = await GiftModel.create({ fk_collection_id: collection.pk_collection_id, name: gift.models[0].name })
    const background = await Background.create({ name: 'Black' })
    const symbol = await GiftSymbol.create({ name: 'Thor Hammer' })
    await CollectionBackground.create({ fk_collection_id: collection.pk_collection_id, fk_background_id: background.pk_background_id })
    await CollectionSymbol.create({ fk_collection_id: collection.pk_collection_id, fk_symbol_id: symbol.pk_symbol_id })
    const savedGift = await Gift.create({
      telegram_gift_id: '987654321234567890', name: 'ArtisanBrick-1', fk_collection_id: collection.pk_collection_id,
      fk_model_id: model.pk_model_id, fk_background_id: background.pk_background_id, fk_symbol_id: symbol.pk_symbol_id,
    })
    const originalGift = savedGift.toJSON()
    const results = await Promise.all([syncChangesCatalog({ loadCatalog }), syncChangesCatalog({ loadCatalog })])
    assert.equal(downloads, 1)
    assert.equal(results.filter((result) => result.skipped).length, 1)
    assert.equal((await marker()).length, 1)
    assert.equal(await Collection.count(), 2)
    assert.equal(await GiftModel.count(), 2)
    await savedGift.reload()
    assert.deepEqual(savedGift.toJSON(), originalGift)
    await collection.reload()
    assert.equal(collection.short_name, 'artisanbrick')
    assert.equal(collection.collection_regular_id, gift.gift.id)
    await model.reload()
    assert.equal(model.rarity, '15')
    await background.reload()
    assert.equal(Number(background.center_color), 0)
    const links = (await sequelize.query(`SELECT rarity FROM collection_symbols ORDER BY fk_collection_id`))[0]
    assert.deepEqual(links.map((row) => row.rarity), ['2', '5'])

    const offline = async () => { throw new Error('API offline') }
    assert.equal((await syncChangesCatalog({ loadCatalog: offline })).skipped, true)
    const previousMarker = await marker()
    await assert.rejects(syncChangesCatalog({ refresh: true, loadCatalog: offline }), /API offline/)
    assert.deepEqual(await marker(), previousMarker)

    // A database failure after collection upserts must roll the entire refresh back.
    const invalid = snapshot()
    invalid.collections[0].display_name = 'Must roll back'
    invalid.models[0].name = null
    await assert.rejects(syncChangesCatalog({ refresh: true, loadCatalog: async () => invalid }))
    await collection.reload()
    assert.equal(collection.display_name, 'Artisan Brick')
    assert.deepEqual(await marker(), previousMarker)

    const refreshed = snapshot()
    refreshed.models[0].rarity = '25'
    refreshed.collections[0].display_name = 'New official name'
    refreshed.collections[0].short_name = 'NewOfficialName'
    assert.equal((await syncChangesCatalog({ refresh: true, loadCatalog: async () => refreshed })).skipped, false)
    await collection.reload()
    await model.reload()
    await savedGift.reload()
    assert.equal(collection.display_name, 'New official name')
    assert.equal(collection.short_name, 'artisanbrick')
    assert.equal(model.rarity, '25')
    assert.deepEqual(savedGift.toJSON(), originalGift)
    assert.equal(await Collection.count(), 2)
    assert.equal((await marker()).length, 1)
  })
