import { placeholderImageFor } from '../../../shared/config/placeholder-images.js'
import { getDateFormatters } from '../../../shared/lib/date-formatters.js'
import { formatGramAmount } from '../../../shared/lib/gram-amount.js'
import { resolveGiftImage } from '../../gifts/lib/gift-utils.js'

const transactionKeys = {
  deposit: 'tx.deposit',
  withdraw: 'tx.withdraw',
  gift_withdrawal_fee: 'tx.giftWithdrawalFee',
  purchase: 'tx.purchase',
  sale: 'tx.sale',
  offer_escrow_lock: 'tx.offerLock',
  offer_escrow_release: 'tx.offerRelease',
  offer_purchase: 'tx.offerPurchase',
  offer_sale: 'tx.offerSale',
  // Fees charged by the earlier marketplace account remain in old histories.
  marketplace_fee: 'tx.marketplaceFee',
}
const statusKeys = { pending: 'wallet.historyPending', failed: 'wallet.historyFailed', canceled: 'wallet.historyCanceled' }
const isClosedUnsettled = (tx) => ['failed', 'canceled'].includes(tx.status)

/** The amount that left or reached the balance: a withdrawal includes its fee,
 * and a released gift withdrawal fee moved nothing. */
const transactionTotalNano = (tx) => tx.tx_kind === 'gift_withdrawal_fee' && isClosedUnsettled(tx)
  ? 0n
  : BigInt(tx.amount_nano ?? 0) + (tx.tx_kind === 'withdraw' ? BigInt(tx.fee_nano ?? 0) : 0n)

const transactionType = (kind, t) => transactionKeys[kind]
  ? t(transactionKeys[kind])
  : String(kind ?? '').split(/[_\s-]+/).filter(Boolean)
    .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1)).join(' ') || 'Transaction'

const validDate = (value) => {
  const date = value ? new Date(value) : null
  return date && Number.isFinite(date.getTime()) ? date : null
}

/** Deposits, withdrawals and gift withdrawal fees for the wallet screen. */
export function formatWalletActions(walletTransactions, currency, t, language = 'en') {
  const formatters = getDateFormatters(language)
  return walletTransactions
    .filter((tx) => ['deposit', 'withdraw', 'gift_withdrawal_fee'].includes(tx.tx_kind))
    .map((tx) => {
      const isCredit = tx.direction === 'credit'
      const createdAt = validDate(tx.created_at)
      const statusLabel = tx.status === 'pending' ? t('wallet.historyPending')
        : isClosedUnsettled(tx) ? t('wallet.historyCanceled') : ''
      return {
        id: String(tx.id ?? ''),
        date: createdAt ? formatters.date.format(createdAt).toUpperCase() : '--',
        type: [transactionType(tx.tx_kind, t), statusLabel].filter(Boolean).join(' · '),
        time: createdAt ? formatters.time.format(createdAt) : '--:--',
        icon: isCredit ? 'deposit' : 'withdraw',
        tone: isCredit ? 'up' : 'down',
        amount: `${isCredit ? '+' : '-'}${formatGramAmount(transactionTotalNano(tx))} ${currency}`,
      }
    })
}

const historyTone = (tx) => {
  if (isClosedUnsettled(tx)) return 'declined'
  if (tx.tx_kind === 'offer_escrow_release') return 'sale'
  if (tx.tx_kind === 'offer_escrow_lock') return 'buy'
  return tx.direction === 'credit' ? 'sale' : 'buy'
}

/** Every ledger entry, with its gift, for the profile history. */
export function formatProfileHistoryItems(walletTransactions, t, language = 'en') {
  const formatter = getDateFormatters(language).short
  return walletTransactions.map((tx) => {
    const giftId = String(tx.related_gift_id ?? '')
    const gift = tx.related_gift ?? null
    const createdAt = validDate(tx.created_at)
    return {
      id: String(tx.id ?? ''),
      title: giftId ? (gift?.title?.trim() || t('common.gift')) : t('tx.wallet'),
      numberLabel: giftId ? `#${String(gift?.number ?? '').trim() || giftId}` : '',
      time: createdAt ? formatter.format(createdAt).replace(',', '') : t('time.unknown'),
      type: statusKeys[tx.status] ? t(statusKeys[tx.status]) : transactionType(tx.tx_kind, t),
      typeTone: historyTone(tx),
      icon: ['deposit', 'withdraw'].includes(tx.tx_kind) ? tx.tx_kind : null,
      price: formatGramAmount(transactionTotalNano(tx)),
      image: resolveGiftImage(gift, placeholderImageFor(giftId)),
    }
  })
}
