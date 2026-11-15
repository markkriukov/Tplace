import { Op } from 'sequelize'
import { addNano, setWalletNano, subtractNano, toNano, walletNano } from '../wallet/wallet-money.utils.js'
import { sequelize } from '../../db/sequelize.js'
import { Offer } from '../../db/models.js'
import { createHttpError } from '../../http/errors.js'
import { createWalletTransaction, createWalletTransactions, getOrCreateWallet, lockWallets } from '../wallet/wallet-ledger.service.js'
import { lockOfferGift } from '../gifts/listings/listings-trade-locks.repository.js'
import { isGiftBlocked } from '../gifts/custody/custody-action-blocks.service.js'

/** A pending offer whose deadline has passed. */
export function isExpiredPendingOffer(offer) {
  return offer.status === 'pending' && offer.expires_at != null && new Date(offer.expires_at).getTime() <= Date.now()
}

/** Expires the offer and releases its escrow. Without a transaction this locks
 * the offer's gift itself and rechecks the offer under that lock. */
export async function expirePendingOfferIfNeeded(offer, transaction = undefined) {
  if (!offer || !isExpiredPendingOffer(offer)) return false

  if (transaction) {
    if (await isGiftBlocked(offer.fk_gift_id, transaction)) return false
    await resolveOfferWithEscrowRelease(offer, 'expired', transaction)
    return true
  }

  return sequelize.transaction(async (lockTransaction) => {
    const lockedOffer = await lockOfferGift(offer.pk_offer_id, lockTransaction)
    if (!lockedOffer || !isExpiredPendingOffer(lockedOffer)) return false
    if (await isGiftBlocked(lockedOffer.fk_gift_id, lockTransaction)) return false
    await resolveOfferWithEscrowRelease(lockedOffer, 'expired', lockTransaction)
    Object.assign(offer, lockedOffer.get())
    return true
  })
}

/** Moves the offer amount from the buyer's available to locked balance. The
 * wallet total is unchanged; the caller journals the lock with it. */
export async function reserveOfferEscrow({ buyerPkUserId, amountNano, transaction }) {
  const wallet = await getOrCreateWallet(buyerPkUserId, transaction)
  const amount = toNano(amountNano)
  const { available, locked, total } = walletNano(wallet)
  if (available < amount) throw createHttpError(400, 'Insufficient available balance', 'INSUFFICIENT_BALANCE')
  setWalletNano(wallet, { available: subtractNano(available, amount), locked: addNano(locked, amount) })
  await wallet.save({ transaction })
  return { wallet, availableBefore: available, total }
}

/**
 * Moves the offer's escrow back to available on the buyer's locked wallet, in
 * memory only, and returns the journal entry; null when nothing was locked.
 */
function releaseEscrowInMemory(offer, buyerWallet, releaseReason) {
  const escrow = toNano(offer.escrow_locked_nano ?? 0)
  if (escrow === 0n) return null

  const { available, locked, total } = walletNano(buyerWallet)
  // Escrow is part of the locked balance. Releasing less would silently keep
  // the buyer's funds, so a shortfall stops the operation for investigation.
  if (locked < escrow) throw new Error('Offer escrow exceeds the locked balance')
  setWalletNano(buyerWallet, { available: addNano(available, escrow), locked: subtractNano(locked, escrow) })
  offer.escrow_locked_nano = '0'

  const offerId = Number(offer.pk_offer_id)
  return {
    fkUserId: offer.fk_buyer_user_id,
    txKind: 'offer_escrow_release',
    direction: 'credit',
    amountNano: escrow,
    balanceBeforeNano: total,
    balanceAfterNano: total,
    giftId: Number(offer.fk_gift_id),
    offerId,
    note: `Unlocked funds for offer #${offerId}`,
    // The rest of the split follows from the balances and the amount.
    meta: { release_reason: releaseReason, available_before_nano: available },
  }
}

/** `wallets` holds already locked buyer wallets by String(user ID). */
export async function releaseOfferEscrow(offer, transaction, releaseReason = 'released', wallets = null) {
  if (!offer || toNano(offer.escrow_locked_nano ?? 0) === 0n) return null
  const buyerWallet = wallets?.get(String(offer.fk_buyer_user_id))
    ?? await getOrCreateWallet(offer.fk_buyer_user_id, transaction)
  const entry = releaseEscrowInMemory(offer, buyerWallet, releaseReason)
  await buyerWallet.save({ transaction })
  await createWalletTransaction({ ...entry, transaction })
  return buyerWallet
}

export async function resolveOfferWithEscrowRelease(offer, status, transaction) {
  const buyerWallet = await releaseOfferEscrow(offer, transaction, status)
  const now = new Date()
  offer.status = status
  offer.resolved_at = now
  offer.updated_at = now
  await offer.save({ transaction })
  return buyerWallet
}

/**
 * Rejects the gift's other pending offers and releases their escrow with one
 * offer UPDATE. Given a `journal` array, the caller saves the returned wallets
 * and inserts the appended entries together with its own; otherwise this does.
 * @returns {Promise<Set<any>>} wallets whose balances changed
 */
export async function rejectPendingOffersForGift({ giftId, excludeOfferId = null, transaction, lockedTrade = null, journal = null }) {
  const offers = lockedTrade
    ? lockedTrade.offers.filter(offer => String(offer.pk_offer_id) !== String(excludeOfferId) && offer.status === 'pending')
    : await Offer.findAll({
      where: {
        fk_gift_id: giftId,
        status: 'pending',
        ...(excludeOfferId != null ? { pk_offer_id: { [Op.ne]: excludeOfferId } } : {}),
      },
      order: [['pk_offer_id', 'ASC']],
      transaction,
      lock: transaction.LOCK.UPDATE,
    })
  const touched = new Set()
  if (!offers.length) return touched

  const wallets = lockedTrade?.wallets ?? await lockWallets(offers.map((offer) => offer.fk_buyer_user_id), transaction)
  const entries = []
  for (const offer of offers) {
    const wallet = wallets.get(String(offer.fk_buyer_user_id))
    const entry = releaseEscrowInMemory(offer, wallet, 'rejected')
    if (entry) {
      entries.push(entry)
      touched.add(wallet)
    }
  }
  const now = new Date()
  const resolution = { status: 'rejected', escrow_locked_nano: '0', resolved_at: now, updated_at: now }
  await Offer.update(resolution, { where: { pk_offer_id: offers.map((offer) => offer.pk_offer_id) }, transaction })
  for (const offer of offers) offer.set(resolution)

  if (journal) {
    journal.push(...entries)
  } else {
    for (const wallet of touched) await wallet.save({ transaction })
    await createWalletTransactions(entries, transaction)
  }
  return touched
}
