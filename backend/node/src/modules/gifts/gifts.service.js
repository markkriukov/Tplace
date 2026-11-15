import { Op } from 'sequelize'
import { queueGiftWithdrawal } from './withdrawals/withdrawals.service.js'
import { assertGiftInCustody } from './custody/custody.service.js'
import { assertGiftNotBlocked } from './custody/custody-action-blocks.service.js'
import { createHttpError } from '../../http/errors.js'
import { lockGiftByPublicId, lockTradeWallets } from './listings/listings-trade-locks.repository.js'
import { settleTrade } from './listings/listings-trade-settlement.service.js'
import { parseSearchCriteria } from '../catalog/search/search.criteria.js'
import { loadGiftSearchPage } from '../catalog/search/search.repository.js'
import { parseLimit } from '../../http/pagination.js'
import { mapGiftToPayload } from './gifts.mapper.js'
import { loadInventorySummary } from './inventory/inventory-summary.repository.js'
import { getOrCreateWallet } from '../wallet/wallet-ledger.service.js'
import { formatNanoAmount, parseAmountToNano } from '../wallet/wallet-money.utils.js'
import { APP_CURRENCY, MARKETPLACE_MAX_PRICE_NANO, MARKETPLACE_MIN_PRICE_NANO, INVENTORY_LIMITS } from '../../config.js'
import { sequelize } from '../../db/sequelize.js'
import { Gift, Ownership, GiftListing } from '../../db/models.js'
import { upsertActiveGiftListing, closeActiveGiftListing } from './listings/listings.service.js'
import { invalidateFiltersCatalogCache } from '../catalog/filters/filters.service.js'
import { rejectPendingOffersForGift } from '../offers/offers-escrow.service.js'
import { mapWalletPayload } from '../wallet/wallet.mapper.js'

export async function getInventory({ currentUser, query }) {
  const criteria = parseSearchCriteria(query)
  const [{ page, pagination }, inventorySummary] = await Promise.all([
    loadGiftSearchPage({
      pkUserId: currentUser.pk_user_id,
      isListed: query.get('listed') === 'true',
      limit: parseLimit(query, INVENTORY_LIMITS),
      criteria,
    }),
    // Totals cover the whole inventory, so only the first page carries them, and
    // a client that still holds them after changing filters sends summary=false.
    criteria.cursor || query.get('summary') === 'false' ? null : loadInventorySummary(currentUser.pk_user_id),
  ])
  return { payload: {
    ok: true,
    gifts: page.map(mapGiftToPayload),
    ...(inventorySummary ? { inventory_summary: inventorySummary } : {}),
    pagination,
  } }
}

async function lockOwnGift(currentUser, giftId, transaction) {
  const ownership = await Ownership.findOne({
    where: { fk_user_id: currentUser.pk_user_id, fk_gift_id: giftId },
    transaction,
    lock: transaction.LOCK.UPDATE,
  })
  if (!ownership) throw createHttpError(403, 'Gift does not belong to current user', 'FORBIDDEN')
}

export async function listGift({ currentUser, body }) {
  const salePriceNano = parseAmountToNano(body.price)
  if (salePriceNano == null) {
    throw createHttpError(400, 'Field price must be a positive number', 'VALIDATION_ERROR')
  }
  if (salePriceNano < MARKETPLACE_MIN_PRICE_NANO || salePriceNano > MARKETPLACE_MAX_PRICE_NANO) {
    throw createHttpError(400, `Field price must be between ${formatNanoAmount(MARKETPLACE_MIN_PRICE_NANO)} and ${formatNanoAmount(MARKETPLACE_MAX_PRICE_NANO)}`, 'AMOUNT_OUT_OF_RANGE')
  }

  const payload = await sequelize.transaction(async (transaction) => {
    const { pk_gift_id: giftId } = await lockGiftByPublicId(body.id, transaction)
    await lockOwnGift(currentUser, giftId, transaction)
    await assertGiftInCustody(giftId, transaction)
    const listing = await upsertActiveGiftListing({
      giftId,
      sellerPkUserId: Number(currentUser.pk_user_id),
      priceNano: salePriceNano,
      currencyCode: APP_CURRENCY,
      transaction,
    })
    return { ok: true, listing: { id: listing.public_id, price_nano: String(salePriceNano) } }
  })
  invalidateFiltersCatalogCache()
  return { payload }
}

export async function buyGift({ currentUser, body }) {
  const listingId = body.listing_id.toLowerCase()
  const payload = await sequelize.transaction(async (transaction) => {
    const { pk_gift_id: giftId } = await lockGiftByPublicId(body.id, transaction)
    const buyerPkUserId = Number(currentUser.pk_user_id)
    // One query reads the gift's active listing and the listing the buyer confirmed.
    const listings = await GiftListing.findAll({
      where: { fk_gift_id: giftId, [Op.or]: [{ status: 'active' }, { public_id: listingId }] },
      transaction,
      lock: transaction.LOCK.UPDATE,
    })
    // A listing sells once. Repeating this buyer's completed direct purchase at the
    // confirmed price (e.g. after a lost response) succeeds without a second debit.
    // The gift lock above serializes it with the original purchase.
    const requestedListing = listings.find(listing => listing.public_id === listingId)
    if (requestedListing?.status === 'sold' && requestedListing.closed_reason === 'sold_direct' &&
        Number(requestedListing.fk_buyer_user_id) === buyerPkUserId &&
        String(requestedListing.price_nano) === String(body.expected_price_nano)) {
      const wallet = await getOrCreateWallet(buyerPkUserId, transaction)
      return { ok: true, wallet: mapWalletPayload(wallet) }
    }
    const activeListing = listings.find(listing => listing.status === 'active')
    if (!activeListing) {
      throw createHttpError(409, 'Gift is no longer listed for sale', 'LISTING_CHANGED')
    }
    if (activeListing.public_id !== listingId ||
        String(activeListing.price_nano) !== String(body.expected_price_nano)) {
      throw createHttpError(409, 'Listing or price changed. Refresh the gift before buying.', 'LISTING_CHANGED')
    }
    const sellerOwnership = await Ownership.findOne({
      where: { fk_gift_id: giftId },
      transaction,
      lock: transaction.LOCK.UPDATE,
    })
    if (!sellerOwnership) {
      throw createHttpError(409, 'Gift owner not found', 'GIFT_OWNER_NOT_FOUND')
    }
    if (String(sellerOwnership.fk_user_id) !== String(activeListing.fk_seller_user_id)) {
      throw createHttpError(409, 'Listing owner changed', 'LISTING_CHANGED')
    }
    const sellerPkUserId = Number(sellerOwnership.fk_user_id)
    if (sellerPkUserId === buyerPkUserId) {
      throw createHttpError(400, 'Cannot buy your own gift', 'OWN_GIFT')
    }

    await assertGiftInCustody(giftId, transaction)
    const lockedTrade = await lockTradeWallets({
      giftId, buyerPkUserId, sellerPkUserId, transaction,
    })
    const { buyerWallet } = await settleTrade({
      source: { listing: activeListing }, giftId, ownership: sellerOwnership, lockedTrade,
      buyerPkUserId, sellerPkUserId, priceNano: activeListing.price_nano,
      currencyCode: activeListing.currency_code, transaction,
    })
    return { ok: true, wallet: mapWalletPayload(buyerWallet) }
  })
  invalidateFiltersCatalogCache()
  return { payload }
}

export async function cancelListing({ currentUser, body }) {
  const canceledListing = await sequelize.transaction(async (transaction) => {
    const { pk_gift_id: giftId } = await lockGiftByPublicId(body.id, transaction)
    await lockOwnGift(currentUser, giftId, transaction)
    await assertGiftNotBlocked(giftId, transaction)
    return closeActiveGiftListing({
      giftId,
      status: 'canceled',
      closedReason: 'canceled_by_seller',
      transaction,
    })
  })
  if (canceledListing) invalidateFiltersCatalogCache()
  return { payload: { ok: true } }
}

export async function withdrawGift({ currentUser, body }) {
  const reference = await Gift.findOne({ attributes: ['pk_gift_id', 'is_test_import'], where: { public_id: body.id.toLowerCase() } })
  if (!reference) throw createHttpError(404, 'Gift not found', 'NOT_FOUND')
  const giftId = reference.pk_gift_id
  if (!reference.is_test_import) return queueGiftWithdrawal({ currentUser, body, giftId })
  await sequelize.transaction(async transaction => {
    // FOR UPDATE rather than the usual NO KEY UPDATE: this transaction deletes the row.
    const gift = await Gift.findByPk(giftId, { transaction, lock: transaction.LOCK.UPDATE })
    if (!gift) throw createHttpError(404, 'Gift not found', 'NOT_FOUND')
    await assertGiftNotBlocked(giftId, transaction)
    await lockOwnGift(currentUser, giftId, transaction)
    if (!gift.is_test_import) {
      await assertGiftInCustody(giftId, transaction)
      throw createHttpError(409, 'Gift withdrawal is not available', 'WITHDRAWAL_UNAVAILABLE')
    }
    const lockedTrade = await lockTradeWallets({ giftId, buyerPkUserId: currentUser.pk_user_id, sellerPkUserId: currentUser.pk_user_id, transaction })
    await rejectPendingOffersForGift({ giftId, transaction, lockedTrade })
    await closeActiveGiftListing({ giftId, status: 'canceled', closedReason: 'test_withdrawal', transaction })
    await sequelize.query('DELETE FROM gift_custody_observations WHERE fk_gift_id = :giftId', { replacements: { giftId }, transaction })
    await gift.destroy({ transaction })
  })
  invalidateFiltersCatalogCache()
  return { payload: { ok: true } }
}
