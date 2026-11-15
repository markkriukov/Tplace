import { createHttpError } from '../../../http/errors.js'
import { SEARCH_SORTS } from '../../../http/schemas.js'
import { parseAmountToNano } from '../../wallet/wallet-money.utils.js'
import { normalizeCollectionAlias } from '../catalog-collection-alias.mapper.js'

/** A price filter bound in nano; zero is a real bound for unlisted inventory. */
function parsePriceBoundNano(rawAmount) {
  const nano = parseAmountToNano(rawAmount, { allowZero: true })
  return nano == null ? null : Number(nano)
}

function parseFilterValues(searchParams, key) {
  const values = searchParams
    .getAll(key)
    .flatMap((value) => String(value ?? '').split(','))
    .map((value) => value.trim())
    .filter(Boolean)

  return {
    raw: [...new Set(values.map((value) => value.toLowerCase()))],
    normalized: [...new Set(values.map(normalizeCollectionAlias).filter(Boolean))],
  }
}

function parseFilterIds(values) {
  const ids = values.flatMap((value) => value.split(',')).map((value) => value.trim())
  if (ids.some((value) => !/^[1-9][0-9]{0,9}$/.test(value) || BigInt(value) > 2147483647n)) {
    throw createHttpError(400, 'Filter IDs must be positive integer values', 'VALIDATION_ERROR')
  }
  return [...new Set(ids)].sort()
}

export function parseSearchCriteria(searchParams) {
  const query = String(searchParams.get('q') ?? '').trim().replace(/^#/, '')
  const sort = String(searchParams.get('sort') ?? '').trim()

  return {
    query,
    cursor: searchParams.get('cursor') || null,
    ids: Object.fromEntries(['collection', 'model', 'background', 'symbol'].map((key) => [
      key, parseFilterIds(searchParams.getAll(`${key}_id`)),
    ])),
    queryNormalized: normalizeCollectionAlias(query),
    // Sales history validates its own sorts and passes them separately.
    sort: SEARCH_SORTS.includes(sort) ? sort : 'priceAsc',
    priceMinNano: parsePriceBoundNano(searchParams.get('price_min')),
    priceMaxNano: parsePriceBoundNano(searchParams.get('price_max')),
    filters: {
      collection: parseFilterValues(searchParams, 'collection'),
      model: parseFilterValues(searchParams, 'model'),
      background: parseFilterValues(searchParams, 'background'),
      symbol: parseFilterValues(searchParams, 'symbol'),
    },
  }
}

const rawTextSql = (expression) => `lower(btrim(coalesce(${expression}, '')))`

const normalizedTextSql = (expression) => `regexp_replace(lower(coalesce(${expression}, '')), '[^a-z0-9]+', '', 'g')`

// A filter value matches a catalog attribute by its exact or its normalized
// name. Names are compared in the small catalog tables, once per query, and the
// gift is matched by key instead of comparing names on every scanned row.
const catalogAttributes = {
  collection: { column: 'g.fk_collection_id', table: 'collections', key: 'pk_collection_id', names: ['display_name', 'short_name'] },
  model: { column: 'g.fk_model_id', table: 'models', key: 'pk_model_id', names: ['name'] },
  background: { column: 'g.fk_background_id', table: 'backgrounds', key: 'pk_background_id', names: ['name'] },
  symbol: { column: 'g.fk_symbol_id', table: 'symbols', key: 'pk_symbol_id', names: ['name'] },
}

function textMatchClauses(replacements, key, expressions, filterValues) {
  const clauses = []
  if (filterValues.raw.length > 0) {
    replacements[`${key}Raw`] = filterValues.raw
    clauses.push(...expressions.map((expression) => `${rawTextSql(expression)} IN (:${key}Raw)`))
  }
  if (filterValues.normalized.length > 0) {
    replacements[`${key}Normalized`] = filterValues.normalized
    clauses.push(...expressions.map((expression) => `${normalizedTextSql(expression)} IN (:${key}Normalized)`))
  }
  return clauses
}

function addTextFilterCondition(whereClauses, replacements, key, filterValues) {
  const { column, table, key: primaryKey, names } = catalogAttributes[key]
  const clauses = textMatchClauses(replacements, key, names, filterValues)
  if (clauses.length === 0) return
  const matches = [`${column} IN (SELECT ${primaryKey} FROM ${table} WHERE ${clauses.join(' OR ')})`]
  // A gift name without its number suffix is the collection slug.
  if (key === 'collection') {
    matches.push(...textMatchClauses(replacements, key, ["regexp_replace(g.name, '-[0-9]+$', '')"], filterValues))
  }
  whereClauses.push(`(${matches.join(' OR ')})`)
}

/** Adds the criteria's filter of one attribute group (`collection`, `model`, `background` or `symbol`) on gift `g`. */
export function addGiftAttributeCondition(whereClauses, replacements, criteria, key) {
  const ids = criteria.ids[key]
  if (ids.length) {
    replacements[`${key}Ids`] = ids
    whereClauses.push(`${catalogAttributes[key].column} IN (:${key}Ids)`)
  } else {
    addTextFilterCondition(whereClauses, replacements, key, criteria.filters[key])
  }
}

/** Adds the criteria's filters on gift `g`; `priceSql` is the price expression. */
export function addGiftSearchCriteriaConditions(whereClauses, replacements, criteria, { priceSql }) {
  for (const key of Object.keys(catalogAttributes)) addGiftAttributeCondition(whereClauses, replacements, criteria, key)
  addGiftQueryAndPriceConditions(whereClauses, replacements, criteria, { priceSql })
}

/** Adds the criteria's search text and price bounds on gift `g`. */
export function addGiftQueryAndPriceConditions(whereClauses, replacements, criteria, { priceSql }) {
  if (criteria.query) {
    replacements.searchPattern = `%${criteria.query}%`
    const searchClauses = ['g.name ILIKE :searchPattern']
    const collectionClauses = ['display_name ILIKE :searchPattern', 'short_name ILIKE :searchPattern']
    if (criteria.queryNormalized) {
      replacements.searchNormalizedPattern = `%${criteria.queryNormalized}%`
      // The stored search_name (gifts.search_name) contains the name without its
      // number suffix as a prefix, so it matches that form as well.
      searchClauses.push('g.search_name LIKE :searchNormalizedPattern')
      collectionClauses.push(
        `${normalizedTextSql('display_name')} LIKE :searchNormalizedPattern`,
        `${normalizedTextSql('short_name')} LIKE :searchNormalizedPattern`
      )
    }
    searchClauses.push(
      `g.fk_collection_id IN (SELECT pk_collection_id FROM collections WHERE ${collectionClauses.join(' OR ')})`,
      'g.fk_model_id IN (SELECT pk_model_id FROM models WHERE name ILIKE :searchPattern)'
    )
    whereClauses.push(`(${searchClauses.join(' OR ')})`)
  }

  if (criteria.priceMinNano != null && criteria.priceMinNano > 0) {
    replacements.priceMinNano = criteria.priceMinNano
    whereClauses.push(`${priceSql} >= :priceMinNano`)
  }
  if (criteria.priceMaxNano != null) {
    replacements.priceMaxNano = criteria.priceMaxNano
    whereClauses.push(`${priceSql} <= :priceMaxNano`)
  }
}
