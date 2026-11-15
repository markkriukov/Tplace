import { resolveInternalId } from '../../http/public-id.js'
import { parseLimit } from '../../http/pagination.js'
import { Op } from 'sequelize'
import { getOrCreateWallet } from './wallet-ledger.service.js'
import { mapWalletPayload, mapWalletTransactionPayload } from './wallet.mapper.js'
import { createPayment, paymentOverview } from './payments/payments.service.js'
import { WalletTransaction, Gift } from '../../db/models.js'
import { WALLET_HISTORY_LIMITS } from '../../config.js'

export async function getWallet({ currentUser }) {
  const wallet = await getOrCreateWallet(currentUser.pk_user_id)
  return { payload: { ok: true, wallet: mapWalletPayload(wallet), ...await paymentOverview(currentUser.pk_user_id) } }
}

// A cheap balance poll: unlike getWallet it skips the TON payment history.
export async function getWalletBalance({ currentUser }) {
  const wallet = await getOrCreateWallet(currentUser.pk_user_id)
  return { payload: { ok: true, wallet: mapWalletPayload(wallet) } }
}

export async function listTransactions({ currentUser, query }) {
  const limit = parseLimit(query, WALLET_HISTORY_LIMITS)
  const cursor = query.get('cursor')
  const beforeKey = cursor ? await resolveInternalId(WalletTransaction, 'pk_wallet_tx_id', cursor, { where: { fk_user_id: currentUser.pk_user_id } }) : null
  const transactions = await WalletTransaction.findAll({
    attributes: ['public_id', 'pk_wallet_tx_id', 'tx_kind', 'direction', 'status', 'amount_nano', 'fee_nano', 'fk_gift_id', 'created_at'],
    where: { fk_user_id: currentUser.pk_user_id, ...(beforeKey ? { pk_wallet_tx_id: { [Op.lt]: beforeKey } } : {}) },
    include: [{ model: Gift, attributes: ['public_id', 'pk_gift_id', 'name'], required: false }],
    order: [['pk_wallet_tx_id', 'DESC']],
    limit: limit + 1,
    raw: true,
    nest: true,
  })
  const page = transactions.slice(0, limit)
  const hasMore = transactions.length > limit
  return { payload: {
    ok: true,
    transactions: page.map(mapWalletTransactionPayload),
    pagination: { limit, has_more: hasMore, next_cursor: hasMore ? page.at(-1).public_id : null },
  } }
}

export function deposit(context) {
  return createPayment(context, 'deposit')
}
export function withdraw(context) {
  return createPayment(context, 'withdraw')
}
