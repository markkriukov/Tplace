import { APP_CURRENCY } from '../../../config.js'
import { GiftListing } from '../../../db/models.js'

export async function upsertActiveGiftListing({
  giftId,
  sellerPkUserId,
  priceNano,
  currencyCode = APP_CURRENCY,
  transaction,
}) {
  const now = new Date()
  const activeListing = await GiftListing.findOne({
    where: { fk_gift_id: giftId, status: 'active' },
    transaction,
    lock: transaction.LOCK.UPDATE,
  })

  if (activeListing) {
    activeListing.fk_seller_user_id = sellerPkUserId
    activeListing.price_nano = String(priceNano)
    activeListing.currency_code = currencyCode
    activeListing.updated_at = now
    await activeListing.save({ transaction })
    return activeListing
  }

  return GiftListing.create(
    {
      fk_gift_id: giftId,
      fk_seller_user_id: sellerPkUserId,
      currency_code: currencyCode,
      price_nano: String(priceNano),
      status: 'active',
      listed_at: now,
      updated_at: now,
    },
    { transaction }
  )
}

export async function closeActiveGiftListing({
  giftId,
  status,
  closedReason,
  buyerUserId = null,
  finalPriceNano = null,
  finalCurrencyCode = null,
  sellerUserId = null,
  listing = null,
  transaction,
}) {
  // A caller that already holds the active listing's row lock passes it in.
  const activeListing = listing ?? await GiftListing.findOne({
    where: { fk_gift_id: giftId, status: 'active' },
    transaction,
    lock: transaction.LOCK.UPDATE,
  })
  // An offer can settle after delisting. Persist a closed sale in the same
  // transaction so the public history has an ID even without an active listing.
  if (!activeListing) {
    if (closedReason !== 'sold_offer' || !sellerUserId || !buyerUserId || !finalPriceNano) return null
    const now = new Date()
    return GiftListing.create({
      fk_gift_id: giftId, fk_seller_user_id: sellerUserId, fk_buyer_user_id: buyerUserId,
      price_nano: String(finalPriceNano), currency_code: finalCurrencyCode ?? APP_CURRENCY,
      status, closed_reason: closedReason, listed_at: now, closed_at: now, updated_at: now,
    }, { transaction })
  }

  const now = new Date()
  activeListing.status = status
  activeListing.closed_reason = closedReason
  activeListing.fk_buyer_user_id = buyerUserId
  if (finalPriceNano != null && BigInt(finalPriceNano) > 0n) {
    activeListing.price_nano = String(finalPriceNano)
  }
  if (typeof finalCurrencyCode === 'string' && finalCurrencyCode.trim()) {
    activeListing.currency_code = finalCurrencyCode.trim().toUpperCase()
  }
  activeListing.closed_at = now
  activeListing.updated_at = now
  await activeListing.save({ transaction })
  return activeListing
}
