import { APP_CURRENCY } from '../../config.js'
import { toIsoString } from '../../http/serialize.js'
import { mapGiftSummary } from '../gifts/gifts.mapper.js'

/**
 * @typedef {Object} WalletRecord
 * @property {string} [currency_code]
 * @property {string | number | bigint} available_nano
 * @property {string | number | bigint} locked_nano
 */
/** @param {WalletRecord} wallet @returns {import('../../http/contracts.js').WalletPayload} */
export function mapWalletPayload(wallet) {
  return {
    currency_code: wallet.currency_code ?? APP_CURRENCY,
    available_nano: String(wallet.available_nano),
    // Offer escrow and pending withdrawals: part of the total, not spendable.
    locked_nano: String(wallet.locked_nano),
  }
}

/** @param {any} tx */
export function mapWalletTransactionPayload(tx) {
  return {
    id: tx.public_id,
    tx_kind: tx.tx_kind,
    direction: tx.direction,
    status: tx.status,
    amount_nano: String(tx.amount_nano ?? 0),
    fee_nano: String(tx.fee_nano ?? 0),
    related_gift_id: tx.Gift?.public_id ?? null,
    related_gift: mapGiftSummary(tx.Gift),
    created_at: toIsoString(tx.created_at),
  }
}
