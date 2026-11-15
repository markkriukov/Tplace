import { Op } from 'sequelize'
import { createHttpError } from '../../http/errors.js'
import { parseLimit } from '../../http/pagination.js'
import { resolveInternalId } from '../../http/public-id.js'
import { assertGiftInCustody } from '../gifts/custody/custody.service.js'
import { assertGiftNotBlocked } from '../gifts/custody/custody-action-blocks.service.js'
import { lockGift, lockOfferGift, lockTradeWallets } from '../gifts/listings/listings-trade-locks.repository.js'
import { settleTrade } from '../gifts/listings/listings-trade-settlement.service.js'
import { invalidateFiltersCatalogCache } from '../catalog/filters/filters.service.js'
import { Offer, Gift, GiftListing, Ownership } from '../../db/models.js'
import { sequelize } from '../../db/sequelize.js'
import { expirePendingOfferIfNeeded, resolveOfferWithEscrowRelease, reserveOfferEscrow } from './offers-escrow.service.js'
import { mapOfferPayload } from './offers.mapper.js'
import { createWalletTransaction } from '../wallet/wallet-ledger.service.js'
import { formatNanoAmount, parseAmountToNano } from '../wallet/wallet-money.utils.js'
import { mapWalletPayload } from '../wallet/wallet.mapper.js'
import { APP_CURRENCY, MARKETPLACE_MAX_PRICE_NANO, MARKETPLACE_MIN_PRICE_NANO, OFFERS_LIMITS } from '../../config.js'

// Returned from a transaction that expired the offer: the expiry and escrow
// release commit, then the request reports the conflict.
const EXPIRED_NOW = Symbol('offer expired by this request')
const offerExpired = () => createHttpError(409, 'Offer has expired', 'OFFER_EXPIRED')

export async function listOffers({ currentUser, query }) {
  const role = query.get('role') ?? 'incoming'
  const status = query.get('status') ?? 'pending'
  const limit = parseLimit(query, OFFERS_LIMITS)
  const userId = currentUser.pk_user_id

  const participant = {
    incoming: { fk_seller_user_id: userId },
    outgoing: { fk_buyer_user_id: userId },
    all: { [Op.or]: [{ fk_seller_user_id: userId }, { fk_buyer_user_id: userId }] },
  }[role]
  const where = { ...participant, ...(status === 'all' ? {} : { status }) }
  const cursor = query.get('cursor')
  if (cursor) {
    // The cursor may name an offer whose status changed since the previous page.
    where.pk_offer_id = { [Op.lt]: await resolveInternalId(Offer, 'pk_offer_id', cursor, { where: participant }) }
  }

  const offers = await Offer.findAll({
    attributes: ['public_id', 'pk_offer_id', 'fk_gift_id', 'fk_seller_user_id', 'amount_nano', 'status', 'created_at', 'expires_at'],
    where,
    include: [{ model: Gift, attributes: ['public_id', 'pk_gift_id', 'name'], required: false }],
    order: [['pk_offer_id', 'DESC']],
    limit: limit + 1,
    raw: true,
    nest: true,
  })

  // Expiry and escrow release belong to the five-second worker. Mutations
  // still recheck expiry under locks; listing offers never writes to the DB.
  const page = offers.slice(0, limit)
  const hasMore = offers.length > limit
  const pendingIncomingCount = cursor ? undefined : await Offer.count({
    where: { fk_seller_user_id: userId, status: 'pending' },
  })
  return { payload: {
    ok: true,
    offers: page.map((offer) => ({
      ...mapOfferPayload(offer),
      direction: Number(offer.fk_seller_user_id) === Number(userId) ? 'incoming' : 'outgoing',
    })),
    ...(pendingIncomingCount === undefined ? {} : { pending_incoming_count: pendingIncomingCount }),
    pagination: { limit, has_more: hasMore, next_cursor: hasMore ? page.at(-1).public_id : null },
  } }
}

export async function createOffer({ currentUser, body }) {
  const giftId = await resolveInternalId(Gift, 'pk_gift_id', body.gift_id)
  const amountNano = parseAmountToNano(body.amount)
  const expiresInHours = Number(body.expires_in_hours ?? 24)

  if (!amountNano) {
    throw createHttpError(400, 'Field amount must be a positive number', 'VALIDATION_ERROR')
  }
  if (amountNano < MARKETPLACE_MIN_PRICE_NANO || amountNano > MARKETPLACE_MAX_PRICE_NANO) {
    throw createHttpError(400, `Field amount must be between ${formatNanoAmount(MARKETPLACE_MIN_PRICE_NANO)} and ${formatNanoAmount(MARKETPLACE_MAX_PRICE_NANO)}`, 'AMOUNT_OUT_OF_RANGE')
  }

  const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000)
  const payload = await sequelize.transaction(async (transaction) => {
    await lockGift(giftId, transaction)
    await assertGiftInCustody(giftId, transaction)
    const activeListing = await GiftListing.findOne({
      where: { fk_gift_id: giftId, status: 'active' },
      attributes: ['price_nano', 'fk_seller_user_id'], transaction, lock: transaction.LOCK.UPDATE,
    })
    if (activeListing && amountNano > BigInt(activeListing.price_nano)) {
      throw createHttpError(400, `Offer amount cannot exceed listed price (${formatNanoAmount(activeListing.price_nano)} ${APP_CURRENCY})`, 'OFFER_ABOVE_PRICE')
    }

    const ownership = await Ownership.findOne({ where: { fk_gift_id: giftId }, transaction, lock: transaction.LOCK.UPDATE })
    if (!ownership) {
      throw createHttpError(409, 'Gift owner not found', 'GIFT_OWNER_NOT_FOUND')
    }
    if (activeListing && String(activeListing.fk_seller_user_id) !== String(ownership.fk_user_id)) {
      throw createHttpError(409, 'Listing owner changed', 'LISTING_CHANGED')
    }

    const sellerPkUserId = Number(ownership.fk_user_id)
    const buyerPkUserId = Number(currentUser.pk_user_id)
    if (buyerPkUserId === sellerPkUserId) {
      throw createHttpError(400, 'Cannot create offer for your own gift', 'OWN_GIFT')
    }

    // A new offer replaces the buyer's pending one for the same gift.
    const existingPendingOffer = await Offer.findOne({
      where: { fk_gift_id: giftId, fk_buyer_user_id: buyerPkUserId, status: 'pending' },
      transaction,
      lock: transaction.LOCK.UPDATE,
    })
    if (existingPendingOffer && !await expirePendingOfferIfNeeded(existingPendingOffer, transaction)) {
      await resolveOfferWithEscrowRelease(existingPendingOffer, 'canceled', transaction)
    }

    const escrow = await reserveOfferEscrow({ buyerPkUserId, amountNano, transaction })
    const createdOffer = await Offer.create({
      fk_gift_id: giftId,
      fk_buyer_user_id: buyerPkUserId,
      fk_seller_user_id: sellerPkUserId,
      currency_code: APP_CURRENCY,
      amount_nano: amountNano.toString(),
      escrow_locked_nano: amountNano.toString(),
      status: 'pending',
      expires_at: expiresAt,
      updated_at: new Date(),
    }, { transaction })
    const offerId = Number(createdOffer.pk_offer_id)

    await createWalletTransaction({
      fkUserId: buyerPkUserId,
      txKind: 'offer_escrow_lock',
      direction: 'debit',
      amountNano,
      // Escrow moves funds within the wallet: its total is unchanged.
      balanceBeforeNano: escrow.total,
      balanceAfterNano: escrow.total,
      giftId,
      offerId,
      note: `Locked funds for offer #${offerId}`,
      // The rest of the split follows from the balances and the amount.
      meta: { available_before_nano: escrow.availableBefore },
      transaction,
    })

    return { ok: true, wallet: mapWalletPayload(escrow.wallet) }
  })

  return { payload }
}

const offerActions = {
  accept: { party: 'fk_seller_user_id', forbidden: 'Only seller can accept this offer', settle: acceptLockedOffer },
  reject: { party: 'fk_seller_user_id', forbidden: 'Only seller can reject this offer', settle: (offer, transaction) => releaseLockedOffer(offer, 'rejected', transaction) },
  cancel: { party: 'fk_buyer_user_id', forbidden: 'Only buyer can cancel this offer', settle: (offer, transaction) => releaseLockedOffer(offer, 'canceled', transaction) },
}

export function acceptOffer(request) {
  return resolveOffer(request, 'accept')
}
export function rejectOffer(request) {
  return resolveOffer(request, 'reject')
}
export function cancelOffer(request) {
  return resolveOffer(request, 'cancel')
}

async function resolveOffer({ currentUser, params }, action) {
  const { party, forbidden, settle } = offerActions[action]
  const offerId = await resolveInternalId(Offer, 'pk_offer_id', params.id)
  const result = await sequelize.transaction(async (transaction) => {
    const offer = await lockOfferGift(offerId, transaction)
    if (!offer) throw createHttpError(404, 'Offer not found', 'NOT_FOUND')
    if (Number(currentUser.pk_user_id) !== Number(offer[party])) throw createHttpError(403, forbidden, 'FORBIDDEN')

    await assertGiftNotBlocked(offer.fk_gift_id, transaction)
    if (await expirePendingOfferIfNeeded(offer, transaction)) return EXPIRED_NOW
    if (offer.status === 'expired') throw offerExpired()
    if (offer.status !== 'pending') throw createHttpError(409, `Offer is already ${offer.status}`, 'OFFER_RESOLVED')
    return settle(offer, transaction)
  })

  if (result === EXPIRED_NOW) throw offerExpired()
  if (action === 'accept') invalidateFiltersCatalogCache()
  return { payload: result }
}

async function acceptLockedOffer(offer, transaction) {
  const sellerPkUserId = Number(offer.fk_seller_user_id)
  const buyerPkUserId = Number(offer.fk_buyer_user_id)
  const giftId = Number(offer.fk_gift_id)
  const ownership = await Ownership.findOne({
    where: { fk_user_id: sellerPkUserId, fk_gift_id: giftId },
    transaction,
    lock: transaction.LOCK.UPDATE,
  })
  if (!ownership) throw createHttpError(409, 'Gift is no longer owned by seller', 'LISTING_CHANGED')

  await assertGiftInCustody(giftId, transaction)
  const lockedTrade = await lockTradeWallets({ giftId, buyerPkUserId, sellerPkUserId, transaction })
  const { sellerWallet } = await settleTrade({
    source: { offer }, giftId, ownership, lockedTrade, buyerPkUserId, sellerPkUserId,
    priceNano: offer.amount_nano, currencyCode: offer.currency_code ?? APP_CURRENCY, transaction,
  })
  return { ok: true, wallet: mapWalletPayload(sellerWallet) }
}

async function releaseLockedOffer(offer, status, transaction) {
  const buyerWallet = await resolveOfferWithEscrowRelease(offer, status, transaction)
  // Only the buyer sees their own wallet change.
  return status === 'canceled' && buyerWallet ? { ok: true, wallet: mapWalletPayload(buyerWallet) } : { ok: true }
}
