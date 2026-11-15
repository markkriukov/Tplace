import { createHttpError } from '../../../http/errors.js'
import { sequelize } from '../../../db/sequelize.js'
import { giftBlocked } from '../custody/custody-action-blocks.service.js'

/** The route has validated the gift's public ID. */
export async function getQuote({ params }) {
  const [[quote]] = await sequelize.query(`
    SELECT gl.public_id AS listing_id, gl.price_nano::text AS price_nano,
      EXISTS (SELECT 1 FROM gift_action_blocks b WHERE b.fk_gift_id = g.pk_gift_id) AS blocked
    FROM gifts g
    LEFT JOIN gift_listings gl ON gl.fk_gift_id = g.pk_gift_id AND gl.status = 'active'
    WHERE g.public_id = CAST(:id AS uuid)
  `, { replacements: { id: params.id.toLowerCase() } })
  if (!quote) throw createHttpError(404, 'Entity not found', 'NOT_FOUND')
  if (quote.blocked) throw giftBlocked()
  if (!quote.listing_id) throw createHttpError(409, 'Gift is no longer listed', 'LISTING_CHANGED')
  return { payload: { ok: true, quote: { listing_id: quote.listing_id, price_nano: quote.price_nano } } }
}
