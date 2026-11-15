import {
  Background,
  Collection,
  CollectionBackground,
  CollectionSymbol,
  GiftModel,
  GiftSymbol,
} from '../../../db/models.js'
import { ADVISORY_LOCKS } from '../../../db/advisory-locks.js'
import { sequelize, withoutTimeouts } from '../../../db/sequelize.js'
import { normalizeCollectionAlias } from '../catalog-collection-alias.mapper.js'
import { loadChangesCatalog } from './sync-changes.client.js'

const SOURCE = 'changes.tg'

async function upsertRows(model, rows, updateOnDuplicate, conflictAttributes, transaction) {
  for (let index = 0; index < rows.length; index += 1000) {
    await model.bulkCreate(rows.slice(index, index + 1000), {
      updateOnDuplicate, conflictAttributes, transaction,
    })
  }
}

async function saveCatalog(catalog, transaction) {
  const existing = await Collection.findAll({
    attributes: ['pk_collection_id', 'short_name', 'collection_regular_id'],
    transaction,
    lock: transaction.LOCK.UPDATE,
  })
  const byRegularId = new Map()
  const byNormalizedName = new Map()
  for (const row of existing) {
    for (const [index, key] of [[byRegularId, String(row.collection_regular_id)], [byNormalizedName, normalizeCollectionAlias(row.short_name)]]) {
      const matches = index.get(key) ?? []
      matches.push(row)
      index.set(key, matches)
    }
  }
  const collections = catalog.collections.map((collection) => {
    const matches = byRegularId.get(collection.collection_regular_id)
      ?? byNormalizedName.get(normalizeCollectionAlias(collection.short_name)) ?? []
    if (matches.length > 1) {
      throw new Error(`Ambiguous existing collection: ${collection.display_name}`)
    }
    const row = matches[0]
    if (row?.collection_regular_id != null && String(row.collection_regular_id) !== collection.collection_regular_id) {
      throw new Error(`Telegram ID conflict for collection: ${collection.display_name}`)
    }
    // Keep existing short names and primary keys, including catalogs imported before Changes API.
    return { ...collection, short_name: row?.short_name ?? collection.short_name }
  })
  await upsertRows(Collection, collections,
    ['display_name', 'collection_regular_id', 'photo_url'], ['short_name'], transaction)
  const collectionRows = await Collection.findAll({
    attributes: ['pk_collection_id', 'short_name'], transaction,
  })
  const byShortName = new Map(collectionRows.map((row) => [row.short_name, row.pk_collection_id]))
  const collectionIds = new Map(collections.map((row) => [row.collection_regular_id, byShortName.get(row.short_name)]))

  await upsertRows(Background, catalog.backgrounds,
    ['center_color', 'edge_color', 'pattern_color', 'text_color'], ['name'], transaction)
  await upsertRows(GiftSymbol, catalog.symbols, ['url'], ['name'], transaction)
  await upsertRows(GiftModel, catalog.models.map(({ collection_regular_id, ...model }) => ({
    ...model, fk_collection_id: collectionIds.get(collection_regular_id),
  })), ['url', 'rarity'], ['fk_collection_id', 'name'], transaction)

  const backgroundRows = await Background.findAll({ attributes: ['pk_background_id', 'name'], transaction })
  const symbolRows = await GiftSymbol.findAll({ attributes: ['pk_symbol_id', 'name'], transaction })
  const backgroundIds = new Map(backgroundRows.map((row) => [row.name, row.pk_background_id]))
  const symbolIds = new Map(symbolRows.map((row) => [row.name, row.pk_symbol_id]))

  // Merge associations without truncating worker-created data or changing existing keys.
  await upsertRows(CollectionBackground, catalog.collectionBackgroundLinks.map((link) => ({
    fk_collection_id: collectionIds.get(link.collection_regular_id),
    fk_background_id: backgroundIds.get(link.name),
    rarity: link.rarity,
  })), ['rarity'], ['fk_collection_id', 'fk_background_id'], transaction)
  await upsertRows(CollectionSymbol, catalog.collectionSymbolLinks.map((link) => ({
    fk_collection_id: collectionIds.get(link.collection_regular_id),
    fk_symbol_id: symbolIds.get(link.name),
    rarity: link.rarity,
  })), ['rarity'], ['fk_collection_id', 'fk_symbol_id'], transaction)
}

export async function syncChangesCatalog({
  refresh = false,
  loadCatalog = loadChangesCatalog,
  onProgress,
} = {}) {
  return sequelize.transaction(async (transaction) => {
    // The download below runs inside this transaction.
    await withoutTimeouts(transaction)
    // Serialize seed commands, including the initial download, across processes.
    await sequelize.query('SELECT pg_advisory_xact_lock(:key)', { replacements: { key: ADVISORY_LOCKS.giftPersistence }, transaction })
    const [imports] = await sequelize.query(
      'SELECT completed_at, counts FROM catalog_sync_state WHERE source = :source',
      { replacements: { source: SOURCE }, transaction }
    )
    if (imports.length && !refresh) {
      return { skipped: true, completedAt: imports[0].completed_at, ...imports[0].counts }
    }

    // All responses are validated before writing any reference data.
    const catalog = await loadCatalog({ onProgress })
    await saveCatalog(catalog, transaction)
    const counts = Object.fromEntries(Object.entries(catalog).map(([key, rows]) => [key, rows.length]))
    const [rows] = await sequelize.query(`
      INSERT INTO catalog_sync_state (source, counts) VALUES (:source, CAST(:counts AS jsonb))
      ON CONFLICT (source) DO UPDATE SET counts = EXCLUDED.counts, completed_at = CURRENT_TIMESTAMP
      RETURNING completed_at
    `, { replacements: { source: SOURCE, counts: JSON.stringify(counts) }, transaction })
    return { skipped: false, completedAt: rows[0].completed_at, ...counts }
  })
}
