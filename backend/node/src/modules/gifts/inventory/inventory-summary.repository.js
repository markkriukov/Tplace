import { sequelize } from '../../../db/sequelize.js'
import { GIFT_ATTRIBUTE_JOINS } from '../../../db/sql.js'

// Each section lists its quantities by attribute combination, so the client can
// count every filter option within the selections of the other filter groups.
function mapInventorySummary(rows) {
  const createSection = () => ({ total: 0, combinations: [] })
  const summary = { on_sale: createSection(), not_on_sale: createSection() }
  for (const row of rows) {
    const section = summary[row.is_listed ? 'on_sale' : 'not_on_sale']
    const quantity = Number(row.quantity)
    section.total += quantity
    section.combinations.push({
      collection: row.collection, model: row.model, background: row.background, symbol: row.symbol, quantity,
    })
  }
  return summary
}

// Totals and filter quantities cover the full inventory, independent of search and pagination.
export async function loadInventorySummary(pkUserId) {
  const [rows] = await sequelize.query(`
    SELECT gl.pk_gift_listing_id IS NOT NULL AS is_listed,
      c.display_name AS collection,
      m.name AS model, b.name AS background, s.name AS symbol, count(*)::int AS quantity
    FROM ownerships o
    JOIN gifts g ON g.pk_gift_id = o.fk_gift_id
    LEFT JOIN gift_listings gl ON gl.fk_gift_id = g.pk_gift_id AND gl.status = 'active'
    ${GIFT_ATTRIBUTE_JOINS}
    WHERE o.fk_user_id = :pkUserId
    GROUP BY 1, 2, 3, 4, 5
    ORDER BY 1, 2, 3, 4, 5
  `, { replacements: { pkUserId } })
  return mapInventorySummary(rows)
}
