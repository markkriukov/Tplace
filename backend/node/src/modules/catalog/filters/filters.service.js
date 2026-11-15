import { createHttpError } from '../../../http/errors.js'
import { normalizeCollectionAlias } from '../catalog-collection-alias.mapper.js'
import { sequelize } from '../../../db/sequelize.js'
import { GIFT_ATTRIBUTE_JOINS } from '../../../db/sql.js'
import { addGiftAttributeCondition, addGiftQueryAndPriceConditions, parseSearchCriteria } from '../search/search.criteria.js'
import {
  mapCollectionPayload,
  mapModelPayload,
  mapBackgroundPayload,
  mapSymbolPayload,
} from './filters.mapper.js'
import { Collection, GiftModel, Background, GiftSymbol, CollectionBackground, CollectionSymbol } from '../../../db/models.js'
import { FILTERS_CATALOG_CACHE_TTL_MS, FILTERS_STATIC_CACHE_TTL_MS } from '../../../config.js'

// Cache promises as well as results; invalidation discards in-flight generations.
function createCache(ttlMs) {
  const entries = new Map()
  return {
    clear: () => entries.clear(),
    get(key, build) {
      const existing = entries.get(key)
      if (existing && Date.now() < existing.expiresAt) return existing.promise
      const entry = { expiresAt: Infinity }
      entry.promise = Promise.resolve().then(build).then(payload => {
        entry.expiresAt = Date.now() + ttlMs
        return payload
      }).catch(error => {
        if (entries.get(key) === entry) entries.delete(key)
        throw error
      })
      entries.set(key, entry)
      if (entries.size > 200) entries.delete(entries.keys().next().value)
      return entry.promise
    },
  }
}

// Catalog rows change only when `npm run db:catalog:sync` runs in another
// process, so they expire by TTL. Trades change only the on-sale counts: they
// rebuild the payloads below from cached catalog rows with one counts query.
const catalogCache = createCache(FILTERS_STATIC_CACHE_TTL_MS)
const filtersCache = createCache(FILTERS_CATALOG_CACHE_TTL_MS)
const countsCache = createCache(FILTERS_CATALOG_CACHE_TTL_MS)

/** Trades call this after commit; `catalog` also drops the catalog rows. */
export function invalidateFiltersCatalogCache({ catalog = false } = {}) {
  filtersCache.clear()
  countsCache.clear()
  if (catalog) catalogCache.clear()
}

export async function loadOnSaleCounts(collectionPkId = null) {
  const scoped = collectionPkId != null
  const first = scoped ? 'model_id' : 'short_name'
  const [rows] = await sequelize.query(`
    WITH active AS (
      SELECT g.fk_model_id AS model_id, g.fk_background_id AS background_id,
        g.fk_symbol_id AS symbol_id,
        ${scoped ? 'NULL::text' : 'c.short_name'} AS short_name
      FROM gift_listings gl JOIN gifts g ON g.pk_gift_id=gl.fk_gift_id
      ${scoped ? '' : 'JOIN collections c ON c.pk_collection_id=g.fk_collection_id'}
      WHERE gl.status='active'
        AND NOT EXISTS (SELECT 1 FROM gift_action_blocks gab WHERE gab.fk_gift_id=g.pk_gift_id)
        ${scoped ? 'AND g.fk_collection_id=:collectionPkId' : ''}
    )
    SELECT CASE WHEN grouping(${first})=0 THEN '${scoped ? 'model' : 'collection'}'
      WHEN grouping(background_id)=0 THEN 'background' ELSE 'symbol' END AS kind,
      coalesce(${first}::text, background_id::text, symbol_id::text) AS key,
      count(*)::int AS quantity
    FROM active GROUP BY GROUPING SETS ((${first}), (background_id), (symbol_id))
  `, { replacements: { collectionPkId } })
  const maps = { collection: new Map(), model: new Map(), background: new Map(), symbol: new Map() }
  for (const row of rows) {
    if (row.key != null) maps[row.kind].set(row.kind === 'collection' ? row.key : Number(row.key), row.quantity)
  }
  return maps
}

const FILTER_GROUPS = ['collection', 'model', 'background', 'symbol']

/**
 * On-sale quantities by catalog ID for each filter group, among the listings that
 * match the search text, price bounds and the selections of the other groups: the
 * number of search results each option adds.
 */
export async function loadFilterCounts(criteria) {
  const replacements = {}
  const shared = []
  addGiftQueryAndPriceConditions(shared, replacements, criteria, { priceSql: 'gl.price_nano' })
  const matches = FILTER_GROUPS.map((key) => {
    const clauses = []
    addGiftAttributeCondition(clauses, replacements, criteria, key)
    return `(${clauses[0] ?? 'true'}) AS ${key}_match`
  })
  const groupCounts = FILTER_GROUPS.map((key) => {
    const others = FILTER_GROUPS.filter((other) => other !== key).map((other) => `${other}_match`)
    return `SELECT '${key}' AS kind, ${key}_id AS key, count(*)::int AS quantity
      FROM active WHERE ${others.join(' AND ')} GROUP BY ${key}_id`
  })
  // The joins and conditions are the search's, so the counts agree with its results.
  const [rows] = await sequelize.query(`
    WITH active AS (
      SELECT g.fk_collection_id AS collection_id, g.fk_model_id AS model_id,
        g.fk_background_id AS background_id, g.fk_symbol_id AS symbol_id, ${matches.join(', ')}
      FROM gift_listings gl JOIN gifts g ON g.pk_gift_id = gl.fk_gift_id
      ${GIFT_ATTRIBUTE_JOINS}
      JOIN collection_backgrounds cb
        ON cb.fk_collection_id = g.fk_collection_id AND cb.fk_background_id = g.fk_background_id
      JOIN collection_symbols cs
        ON cs.fk_collection_id = g.fk_collection_id AND cs.fk_symbol_id = g.fk_symbol_id
      WHERE gl.status = 'active'
        AND NOT EXISTS (SELECT 1 FROM gift_action_blocks gab WHERE gab.fk_gift_id = g.pk_gift_id)
        ${shared.map((clause) => `AND ${clause}`).join(' ')}
    )
    ${groupCounts.join(' UNION ALL ')}
  `, { replacements })
  const counts = Object.fromEntries(FILTER_GROUPS.map((key) => [key, {}]))
  for (const row of rows) counts[row.kind][String(row.key)] = row.quantity
  return counts
}

/** Collection IDs by regular gift ID, exact name and normalized alias, in that precedence. */
export function loadCollectionLookup() {
  return catalogCache.get('collections', async () => {
    const collections = await Collection.findAll({
      attributes: ['pk_collection_id', 'short_name', 'display_name', 'collection_regular_id'],
      order: [['pk_collection_id', 'ASC']],
    })
    const lookup = { byRegularId: new Map(), byName: new Map(), byAlias: new Map() }
    const add = (map, key, id) => { if (key && !map.has(key)) map.set(key, id) }
    for (const field of ['short_name', 'display_name']) {
      for (const collection of collections) {
        const id = Number(collection.pk_collection_id)
        add(lookup.byName, collection[field], id)
        add(lookup.byAlias, normalizeCollectionAlias(collection[field]), id)
      }
    }
    for (const collection of collections) {
      if (collection.collection_regular_id != null) {
        add(lookup.byRegularId, String(collection.collection_regular_id), Number(collection.pk_collection_id))
      }
    }
    return lookup
  })
}

async function resolveCollectionId(name, regularId) {
  const lookup = await loadCollectionLookup()
  return lookup.byRegularId.get(regularId) ?? lookup.byName.get(name) ??
    lookup.byAlias.get(normalizeCollectionAlias(name)) ?? null
}

export async function loadCollectionFiltersPayload(collectionName, collectionRegularId = '') {
  const collectionPkId = await resolveCollectionId(collectionName, collectionRegularId)
  if (collectionPkId == null) return null
  return filtersCache.get(`collection:${collectionPkId}`, () => buildCollectionFilters(collectionPkId))
}

function loadCollectionCatalog(collectionPkId) {
  return catalogCache.get(`collection:${collectionPkId}`, async () => {
    const [models, backgroundLinks, symbolLinks] = await Promise.all([
      GiftModel.findAll({
        attributes: ['pk_model_id', 'name', 'rarity', 'url'],
        where: { fk_collection_id: collectionPkId },
        order: [['name', 'ASC']],
      }),
      CollectionBackground.findAll({
        attributes: ['rarity'],
        where: { fk_collection_id: collectionPkId },
        include: [{ model: Background, attributes: ['pk_background_id', 'name', 'center_color', 'edge_color', 'pattern_color'] }],
        order: [[Background, 'name', 'ASC']],
      }),
      CollectionSymbol.findAll({
        attributes: ['rarity'],
        where: { fk_collection_id: collectionPkId },
        include: [{ model: GiftSymbol, attributes: ['pk_symbol_id', 'name', 'url'] }],
        order: [[GiftSymbol, 'name', 'ASC']],
      }),
    ])
    return { models, backgroundLinks, symbolLinks }
  })
}

async function buildCollectionFilters(collectionPkId) {
  const [{ models, backgroundLinks, symbolLinks }, counts] = await Promise.all([
    loadCollectionCatalog(collectionPkId),
    loadOnSaleCounts(collectionPkId),
  ])
  return {
    models: models.map((model) => mapModelPayload(model, counts.model)),
    backgrounds: backgroundLinks.map((link) => mapBackgroundPayload(link.Background, counts.background, link.rarity)),
    symbols: symbolLinks.map((link) => mapSymbolPayload(link.GiftSymbol, counts.symbol, link.rarity)),
  }
}

function loadFiltersCatalog() {
  return catalogCache.get('catalog', async () => {
    const [collections, backgrounds, symbols] = await Promise.all([
      Collection.findAll({
        attributes: ['pk_collection_id', 'short_name', 'display_name', 'collection_regular_id', 'photo_url'],
        order: [['short_name', 'ASC']],
      }),
      Background.findAll({
        attributes: ['pk_background_id', 'name', 'center_color', 'edge_color', 'pattern_color'],
        order: [['name', 'ASC']],
      }),
      GiftSymbol.findAll({
        attributes: ['pk_symbol_id', 'name', 'url'],
        order: [['name', 'ASC']],
      }),
    ])
    return { collections, backgrounds, symbols }
  })
}

async function buildFiltersCatalogPayload() {
  const [{ collections, backgrounds, symbols }, counts] = await Promise.all([
    loadFiltersCatalog(),
    loadOnSaleCounts(),
  ])
  return {
    ok: true,
    collections: collections.map((collection) => ({
      ...mapCollectionPayload(collection),
      on_sale_count: counts.collection.get(collection.short_name) ?? 0,
    })),
    backgrounds: backgrounds.map((background) => mapBackgroundPayload(background, counts.background)),
    symbols: symbols.map((symbol) => mapSymbolPayload(symbol, counts.symbol)),
  }
}

export function loadCachedFiltersCatalogPayload() {
  return filtersCache.get('catalog', buildFiltersCatalogPayload)
}

export async function getCollectionFilters({ query }) {
  const collectionName = String(query.get('collection') ?? '').trim()
  const collectionRegularId = String(query.get('collection_regular_id') ?? '').trim()
  if (!collectionName && !collectionRegularId) {
    throw createHttpError(400, 'collection or collection_regular_id query param is required', 'VALIDATION_ERROR')
  }
  const payload = await loadCollectionFiltersPayload(collectionName, collectionRegularId)
  if (!payload) throw createHttpError(404, 'Collection not found', 'NOT_FOUND')
  return { payload: { ok: true, ...payload } }
}

export async function getFilterCounts({ query }) {
  // Counts ignore the page and its order, so those share a cache entry.
  const criteria = { ...parseSearchCriteria(query), cursor: null, sort: null }
  const counts = await countsCache.get(JSON.stringify(criteria), () => loadFilterCounts(criteria))
  return { payload: { ok: true, counts } }
}

export async function getFilters() {
  return { payload: await loadCachedFiltersCatalogPayload() }
}
