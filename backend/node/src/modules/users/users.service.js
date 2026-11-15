import { Ownership } from '../../db/models.js'
import { sequelize } from '../../db/sequelize.js'

export async function getProfile({ currentUser }) {
  const [gifts, [[trades]]] = await Promise.all([
    Ownership.count({ where: { fk_user_id: currentUser.pk_user_id } }),
    sequelize.query(`SELECT
      count(*) FILTER (WHERE tx_kind IN ('sale', 'offer_sale'))::int AS sales,
      count(*) FILTER (WHERE tx_kind IN ('purchase', 'offer_purchase'))::int AS buys
      FROM wallet_transactions WHERE fk_user_id=:user AND status='completed'
        AND tx_kind IN ('sale', 'offer_sale', 'purchase', 'offer_purchase')`,
    { replacements: { user: currentUser.pk_user_id } }),
  ])
  return { payload: { ok: true, profile: { stats: { gifts, sales: trades.sales, buys: trades.buys } } } }
}
