import { Gift, Offer } from '../../../db/models.js'
import { lockWallets } from '../../wallet/wallet-ledger.service.js'
import { createHttpError } from '../../../http/errors.js'

// All gift mutations take this lock before offers, ownerships or wallets.
// NO KEY UPDATE excludes every other gift lock (the worker's FOR UPDATE
// included) but not the key-share locks of inserts that reference the gift.
export async function lockGift(giftId, transaction) {
  const gift = await Gift.findByPk(giftId, { transaction, lock: transaction.LOCK.NO_KEY_UPDATE })
  if (!gift) throw createHttpError(404, 'Gift not found', 'NOT_FOUND')
  return gift
}

/** Locks the gift by its public ID; the request schema has validated the ID. */
export async function lockGiftByPublicId(publicId, transaction) {
  const gift = await Gift.findOne({ where: { public_id: publicId }, transaction, lock: transaction.LOCK.NO_KEY_UPDATE })
  if (!gift) throw createHttpError(404, 'Gift not found', 'NOT_FOUND')
  return gift
}

export async function lockOfferGift(offerId, transaction) {
  const reference = await Offer.findByPk(offerId, { attributes: ['fk_gift_id'], transaction })
  if (!reference) throw createHttpError(404, 'Offer not found', 'NOT_FOUND')
  await lockGift(reference.fk_gift_id, transaction)
  return Offer.findByPk(offerId, { transaction, lock: transaction.LOCK.UPDATE })
}

export async function lockTradeWallets({ giftId, buyerPkUserId, sellerPkUserId, transaction }) {
  const offers = await Offer.findAll({
    where: { fk_gift_id: giftId, status: 'pending' },
    order: [['pk_offer_id', 'ASC']], transaction, lock: transaction.LOCK.UPDATE,
  })
  // Include every wallet that escrow release will touch, across all offers.
  const wallets = await lockWallets([buyerPkUserId, sellerPkUserId, ...offers.map((offer) => offer.fk_buyer_user_id)], transaction)
  return {
    offers, wallets,
    buyerWallet: wallets.get(String(buyerPkUserId)),
    sellerWallet: wallets.get(String(sellerPkUserId)),
  }
}
