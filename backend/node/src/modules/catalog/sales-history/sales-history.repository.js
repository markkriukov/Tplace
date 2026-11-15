import { addGiftSearchCriteriaConditions } from '../search/search.criteria.js'
import { addCursorCondition, cursorScope, cursorValueSql, pageOf } from '../../../http/keyset-cursor.js'
import { sequelize } from '../../../db/sequelize.js'
import { GIFT_ATTRIBUTE_JOINS, isoTimestampSql } from '../../../db/sql.js'

const sorts = {
  soldDesc: ['gl.closed_at', 'timestamptz', 'DESC'],
  soldAsc: ['gl.closed_at', 'timestamptz', 'ASC'],
  priceAsc: ['gl.price_nano', 'bigint', 'ASC'],
  priceDesc: ['gl.price_nano', 'bigint', 'DESC'],
}

/** One query returns a page of completed sales with their gift attributes. */
export async function loadSalesHistoryPage({ limit, criteria, sort }) {
  const [expression, type, direction] = sorts[sort]
  const { cursor, ...filterCriteria } = criteria
  const scope = cursorScope({ sales: true, criteria: filterCriteria, sort })
  const where = ["gl.status = 'sold'", 'gl.closed_at IS NOT NULL']
  const replacements = { limitPlusOne: limit + 1 }
  addGiftSearchCriteriaConditions(where, replacements, criteria, { priceSql: 'gl.price_nano' })
  addCursorCondition(where, replacements, cursor, {
    scope, expression, type, direction, nullable: false, idExpression: 'gl.pk_gift_listing_id',
    idLookup: 'SELECT pk_gift_listing_id FROM gift_listings WHERE public_id=CAST(:cursorId AS uuid)',
  })
  const [rows] = await sequelize.query(`
    SELECT gl.public_id, gl.price_nano, gl.currency_code,
      ${isoTimestampSql('gl.closed_at')} AS sold_at,
      g.public_id AS gift_id, g.pk_gift_id, g.name, c.display_name AS collection_name,
      m.name AS model_name, b.name AS background_name, s.name AS symbol_name,
      ${cursorValueSql(expression, type)} AS cursor_value
    FROM gift_listings gl
    JOIN gifts g ON g.pk_gift_id = gl.fk_gift_id
    ${GIFT_ATTRIBUTE_JOINS}
    WHERE ${where.join(' AND ')}
    ORDER BY ${expression} ${direction}, gl.pk_gift_listing_id ${direction}
    LIMIT :limitPlusOne
  `, { replacements })
  return pageOf(rows, limit, scope)
}
