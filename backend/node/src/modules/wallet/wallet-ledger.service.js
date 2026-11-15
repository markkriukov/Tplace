import { feeNano as exactFeeNano, jsonSafe, nanoString, toNano } from './wallet-money.utils.js'
import { WalletBalance, WalletTransaction } from '../../db/models.js'
import { APP_CURRENCY, MARKETPLACE_FEE_BPS } from '../../config.js'

const walletDefaults = { currency_code: APP_CURRENCY, available_nano: 0, locked_nano: 0 }

/**
 * Locks the users' wallets with one query, in ascending user ID order (the lock
 * order every trade and the worker use). Inserting a user creates its wallet
 * (trigger users_create_wallet), so the insert below only repairs a missing row.
 * @returns {Promise<Map<string, any>>} wallets by String(user ID)
 */
export async function lockWallets(pkUserIds, transaction) {
  const ids = [...new Set(pkUserIds.map(Number))].sort((a, b) => a - b)
  const lock = () => WalletBalance.findAll({
    where: { fk_user_id: ids }, order: [['fk_user_id', 'ASC']], transaction, lock: transaction.LOCK.UPDATE,
  })
  let wallets = await lock()
  if (wallets.length < ids.length) {
    await WalletBalance.bulkCreate(ids.map(id => ({ ...walletDefaults, fk_user_id: id })), { transaction, ignoreDuplicates: true })
    wallets = await lock()
  }
  return new Map(wallets.map(wallet => [String(wallet.fk_user_id), wallet]))
}

/** Without a transaction this reads the balance only; with one it locks the row. */
export async function getOrCreateWallet(pkUserId, transaction = undefined) {
  if (transaction) return (await lockWallets([pkUserId], transaction)).get(String(Number(pkUserId)))
  const existing = await WalletBalance.findOne({ where: { fk_user_id: pkUserId }, attributes: ['currency_code', 'available_nano', 'locked_nano'] })
  if (existing) return existing
  const [wallet] = await WalletBalance.findOrCreate({ where: { fk_user_id: pkUserId }, defaults: walletDefaults })
  return wallet
}

const walletTransactionRow = ({
  fkUserId,
  txKind,
  direction,
  amountNano,
  feeNano = 0,
  balanceBeforeNano,
  balanceAfterNano,
  giftId = null,
  offerId = null,
  counterpartyUserId = null,
  note = null,
  meta = {},
  idempotencyKey = null,
}) => ({
  fk_user_id: fkUserId,
  tx_kind: txKind,
  direction,
  status: 'completed',
  amount_nano: nanoString(amountNano),
  fee_nano: nanoString(feeNano),
  balance_before_nano: nanoString(balanceBeforeNano),
  balance_after_nano: nanoString(balanceAfterNano),
  fk_gift_id: giftId,
  fk_offer_id: offerId,
  fk_counterparty_user_id: counterpartyUserId,
  note,
  meta: jsonSafe(meta),
  idempotency_key: idempotencyKey,
  finalized_at: new Date(),
})

/** Journals several completed entries with one INSERT. */
export async function createWalletTransactions(entries, transaction) {
  if (entries.length) await WalletTransaction.bulkCreate(entries.map(walletTransactionRow), { transaction })
}

export async function createWalletTransaction({ transaction = undefined, ...entry }) {
  await WalletTransaction.create(walletTransactionRow(entry), transaction ? { transaction } : undefined)
}

/** @param {string | number | bigint} amountNano @returns {bigint} */
export function calculateMarketplaceFeeNano(amountNano) {
  return exactFeeNano(toNano(amountNano), MARKETPLACE_FEE_BPS)
}
