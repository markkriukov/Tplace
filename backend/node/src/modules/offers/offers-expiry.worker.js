import { Op, literal } from 'sequelize'
import { Offer } from '../../db/models.js'
import { ADVISORY_LOCKS } from '../../db/advisory-locks.js'
import { sequelize, withoutTimeouts } from '../../db/sequelize.js'
import { startPollingWorker } from '../../polling-worker.js'
import { expirePendingOfferIfNeeded } from './offers-escrow.service.js'
import { logError } from '../../log.js'

// Every API process runs this worker; a cross-process advisory lock lets one
// pass run at a time and the others skip it. The lock transaction only holds
// the lock: each offer expires in its own transaction.
export async function expireOffers() {
  return sequelize.transaction(async (lockTransaction) => {
    await withoutTimeouts(lockTransaction)
    const [[{ acquired }]] = await sequelize.query('SELECT pg_try_advisory_xact_lock(:key) AS acquired',
      { replacements: { key: ADVISORY_LOCKS.offerExpiry }, transaction: lockTransaction })
    if (!acquired) return 0
    const offers = await Offer.findAll({
      where: { status: 'pending', expires_at: { [Op.lte]: new Date() },
        [Op.and]: literal('NOT EXISTS (SELECT 1 FROM gift_action_blocks b WHERE b.fk_gift_id = "Offer".fk_gift_id)') },
      order: [['expires_at', 'ASC'], ['pk_offer_id', 'ASC']], limit: 100,
    })
    for (const offer of offers) {
      try { await expirePendingOfferIfNeeded(offer) }
      catch (error) { logError('offer_expiry_retry', error, { offer_id: String(offer.pk_offer_id) }) }
    }
    return offers.length
  })
}

export function startOfferExpiryWorker() {
  return startPollingWorker(expireOffers, { intervalMs: 5000, errorEvent: 'offer_expiry_failed' })
}
