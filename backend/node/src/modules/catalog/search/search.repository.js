import { sequelize } from '../../../db/sequelize.js'
import { GIFT_ATTRIBUTE_JOINS, isoTimestampSql } from '../../../db/sql.js'
import { addCursorCondition, cursorScope, cursorValueSql, pageOf } from '../../../http/keyset-cursor.js'
import { addGiftSearchCriteriaConditions } from './search.criteria.js'

/**
 * One query returns a page of gift cards. pkUserId selects that user's inventory
 * (isListed picks the section); otherwise active listings are searched and
 * viewerId marks the viewer's own gifts.
 */
export function buildGiftSearchQuery({ limit, criteria, pkUserId, isListed, viewerId }) {
  const inventory = pkUserId != null
  const price = inventory ? 'coalesce(gl.price_nano, 0)' : 'gl.price_nano'
  const sorts = {
    price: [price, 'bigint'], created: ['gl.listed_at', 'timestamptz'],
    giftNumber: ['g.gift_number', 'numeric'],
    collection: ['lower(c.display_name)', 'text'],
    modelRarity: ['m.rarity_numeric', 'numeric'],
    backgroundRarity: ['cb.rarity_numeric', 'numeric'],
    symbolRarity: ['cs.rarity_numeric', 'numeric'],
  }
  const direction = criteria.sort.endsWith('Desc') ? 'DESC' : 'ASC'
  const [expression, type] = sorts[criteria.sort.replace(/(Asc|Desc)$/, '')] ?? sorts.price
  const idExpression = inventory ? 'g.pk_gift_id' : 'gl.fk_gift_id'
  const nullable = criteria.sort.startsWith('collection') || criteria.sort.includes('Rarity') ||
    (inventory && criteria.sort.startsWith('created'))
  const { cursor, ...filterCriteria } = criteria
  const scope = cursorScope({ criteria: filterCriteria, user: pkUserId ?? null, isListed: isListed ?? null })
  const where = inventory
    ? ['o.fk_user_id = :pkUserId', `gl.pk_gift_listing_id IS ${isListed ? 'NOT ' : ''}NULL`]
    : ["gl.status = 'active'", 'NOT EXISTS (SELECT 1 FROM gift_action_blocks gab WHERE gab.fk_gift_id = g.pk_gift_id)']
  const replacements = { limitPlusOne: limit + 1, pkUserId, viewerId }
  addGiftSearchCriteriaConditions(where, replacements, criteria, { priceSql: price })
  addCursorCondition(where, replacements, cursor, {
    scope, expression, type, idExpression, direction, nullable,
    idLookup: 'SELECT pk_gift_id FROM gifts WHERE public_id=CAST(:cursorId AS uuid)',
  })
  const owned = inventory ? 'true'
    : viewerId != null ? 'EXISTS (SELECT 1 FROM ownerships ow WHERE ow.fk_gift_id = g.pk_gift_id AND ow.fk_user_id = :viewerId)'
      : 'false'
  const sql = `SELECT g.public_id, g.pk_gift_id, g.name, g.is_test_import,
      c.display_name AS collection_name, m.name AS model_name, m.rarity AS model_rarity,
      b.name AS background_name, cb.rarity AS background_rarity,
      s.name AS symbol_name, cs.rarity AS symbol_rarity,
      gl.public_id AS listing_id, gl.price_nano,
      ${isoTimestampSql('gl.listed_at')} AS listed_at,
      ${owned} AS is_owned, ${cursorValueSql(expression, type)} AS cursor_value
    FROM gifts g
    ${inventory ? 'JOIN ownerships o ON o.fk_gift_id = g.pk_gift_id' : ''}
    ${inventory ? 'LEFT JOIN' : 'JOIN'} gift_listings gl
      ON gl.fk_gift_id = g.pk_gift_id AND gl.status = 'active'
    ${GIFT_ATTRIBUTE_JOINS}
    JOIN collection_backgrounds cb
      ON cb.fk_collection_id = g.fk_collection_id
      AND cb.fk_background_id = g.fk_background_id
    JOIN collection_symbols cs
      ON cs.fk_collection_id = g.fk_collection_id
      AND cs.fk_symbol_id = g.fk_symbol_id
    WHERE ${where.join(' AND ')}
    ORDER BY ${expression} ${direction} ${nullable ? 'NULLS LAST' : ''}, ${idExpression} ${direction}
    LIMIT :limitPlusOne`
  return { sql, replacements, scope }
}

export async function loadGiftSearchPage(options) {
  const { sql, replacements, scope } = buildGiftSearchQuery(options)
  const [rows] = await sequelize.query(sql, { replacements })
  return pageOf(rows, options.limit, scope)
}
