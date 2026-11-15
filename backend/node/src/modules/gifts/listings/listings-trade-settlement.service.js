import { createHttpError } from '../../../http/errors.js'
import { addNano, setWalletNano, subtractNano, toNano, walletNano } from '../../wallet/wallet-money.utils.js'
import { calculateMarketplaceFeeNano, createWalletTransactions } from '../../wallet/wallet-ledger.service.js'
import { recordMarketplaceFee } from '../../marketplace-fees/marketplace-fees.service.js'
import { rejectPendingOffersForGift } from '../../offers/offers-escrow.service.js'
import { closeActiveGiftListing } from './listings.service.js'

const kinds = {
  listing: { buyerTx: 'purchase', sellerTx: 'sale', closedReason: 'sold_direct', insufficient: 'Insufficient balance' },
  offer: { buyerTx: 'offer_purchase', sellerTx: 'offer_sale', closedReason: 'sold_offer', insufficient: 'Buyer has insufficient balance' },
}

/**
 * Settle one sale: release competing offers, debit the buyer (escrow first),
 * credit the seller net of the marketplace fee, move ownership, close the
 * listing, journal both sides and accrue the fee.
 *
 * The caller holds the gift, ownership and listing/offer row locks, and
 * `lockedTrade` from lockTradeWallets(), and has already checked that buyer and
 * seller differ and that the seller still owns the gift.
 *
 * @param {{
 *   source: {listing: any, offer?: undefined} | {offer: any, listing?: undefined},
 *   giftId: number, ownership: any, lockedTrade: any,
 *   buyerPkUserId: number, sellerPkUserId: number,
 *   priceNano: string | number | bigint, currencyCode: string, transaction: any,
 * }} trade
 */
export async function settleTrade({ source, giftId, ownership, lockedTrade, buyerPkUserId, sellerPkUserId, priceNano, currencyCode, transaction }) {
  const { offer, listing } = source
  const kind = offer ? kinds.offer : kinds.listing
  const offerId = offer ? Number(offer.pk_offer_id) : null
  const { buyerWallet, sellerWallet } = lockedTrade

  // Releasing other buyers' escrow first also refunds this buyer's own pending
  // offer on a direct purchase, so it counts toward the balance check below.
  // Wallet rows and ledger entries are written once, after every change.
  const journal = []
  const releasedWallets = await rejectPendingOffersForGift({ giftId, excludeOfferId: offerId, transaction, lockedTrade, journal })

  const price = toNano(priceNano)
  const fee = calculateMarketplaceFeeNano(price)
  const sellerCredit = subtractNano(price, fee)
  const escrow = offer ? toNano(offer.escrow_locked_nano) : 0n
  if (escrow > price) throw new Error('Offer escrow exceeds the offer amount')

  const buyer = walletNano(buyerWallet)
  if (buyer.locked < escrow) throw new Error('Offer escrow exceeds the buyer locked balance')
  const availableDebit = price - escrow
  if (buyer.available < availableDebit) throw createHttpError(400, kind.insufficient, 'INSUFFICIENT_BALANCE')
  setWalletNano(buyerWallet, { available: buyer.available - availableDebit, locked: buyer.locked - escrow })

  const seller = walletNano(sellerWallet)
  setWalletNano(sellerWallet, { available: addNano(seller.available, sellerCredit), locked: seller.locked })
  for (const wallet of new Set([...releasedWallets, buyerWallet, sellerWallet])) await wallet.save({ transaction })

  ownership.fk_user_id = buyerPkUserId
  ownership.acquired_at = new Date()
  await ownership.save({ transaction })

  const closedListing = await closeActiveGiftListing({
    giftId, status: 'sold', closedReason: kind.closedReason, buyerUserId: buyerPkUserId,
    ...(offer ? { sellerUserId: sellerPkUserId, finalPriceNano: price, finalCurrencyCode: currencyCode } : { listing }),
    transaction,
  })

  if (offer) {
    offer.status = 'accepted'
    offer.escrow_locked_nano = '0'
    offer.resolved_at = new Date()
    offer.updated_at = new Date()
    await offer.save({ transaction })
  }

  const note = offer ? `Accepted offer #${offerId}` : null
  // An offer names both sides and its fee entry; a direct sale stores the
  // counterparty, and the buyer's row the fee it paid through the price.
  journal.push({
    fkUserId: buyerPkUserId, txKind: kind.buyerTx, direction: 'debit',
    amountNano: price, feeNano: 0n,
    balanceBeforeNano: buyer.total, balanceAfterNano: buyerWallet.total_nano,
    giftId, offerId, counterpartyUserId: offer ? null : sellerPkUserId, note: note ?? `Purchase gift #${giftId}`,
    meta: offer ? {} : { marketplace_fee_nano: fee },
  }, {
    fkUserId: sellerPkUserId, txKind: kind.sellerTx, direction: 'credit',
    amountNano: sellerCredit, feeNano: fee,
    balanceBeforeNano: seller.total, balanceAfterNano: sellerWallet.total_nano,
    giftId, offerId, counterpartyUserId: offer ? null : buyerPkUserId, note: note ?? `Sale gift #${giftId}`,
  })
  await createWalletTransactions(journal, transaction)
  await recordMarketplaceFee({
    ...(offer ? { offerId: offer.pk_offer_id } : { listingId: (listing ?? closedListing).pk_gift_listing_id }),
    amountNano: fee, currencyCode, transaction,
  })
  return { buyerWallet, sellerWallet }
}
