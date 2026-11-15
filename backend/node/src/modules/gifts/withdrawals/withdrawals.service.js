import { resolveInternalId } from '../../../http/public-id.js'
import { APP_CURRENCY, GIFT_WITHDRAWAL_FEE_NANO, custodySettings } from '../../../config.js'
import { sequelize } from '../../../db/sequelize.js'
import { Gift, Ownership, User, WalletBalance, WalletTransaction } from '../../../db/models.js'
import { createHttpError } from '../../../http/errors.js'
import { assertGiftInCustody } from '../custody/custody.service.js'
import { assertGiftNotBlocked } from '../custody/custody-action-blocks.service.js'
import { lockGift, lockTradeWallets } from '../listings/listings-trade-locks.repository.js'
import { closeActiveGiftListing } from '../listings/listings.service.js'
import { rejectPendingOffersForGift } from '../../offers/offers-escrow.service.js'
import { invalidateFiltersCatalogCache } from '../../catalog/filters/filters.service.js'
import { formatNanoAmount, setWalletNano, walletNano } from '../../wallet/wallet-money.utils.js'
import { mapWalletPayload } from '../../wallet/wallet.mapper.js'

/** Withdrawals the worker has not finished: queued, sending or awaiting review. */
export const ACTIVE_WITHDRAWAL_STATUSES = ['queued', 'sending', 'review']
const activeStatusesSql = ACTIVE_WITHDRAWAL_STATUSES.map(status => `'${status}'`).join(',')
const feeLabel = `${formatNanoAmount(GIFT_WITHDRAWAL_FEE_NANO)} ${APP_CURRENCY}`

const columns = `public_id::text AS id, fk_gift_id::text AS gift_id, status, error_code, fee_nano::text,
  CASE WHEN error_code='TRANSFER_LOCKED' THEN
    (SELECT next_transfer_at FROM telegram_gift_deposits
      WHERE pk_deposit_id=gift_withdrawals.fk_deposit_id AND next_transfer_at>now())
  END AS available_at`
const mapJob = job => ({
  id: job.id, status: job.status, error_code: job.error_code,
  fee_nano: job.fee_nano, available_at: job.available_at,
})
const response = job => ({ statusCode: job.status === 'completed' ? 200 : 202, payload: { ok: true, job: mapJob(job) } })
const walletPayload = async userId => {
  const wallet = await WalletBalance.findOne({ attributes: ['currency_code', 'available_nano', 'locked_nano'], where: { fk_user_id: userId } })
  return wallet ? mapWalletPayload(wallet) : null
}

export async function getGiftWithdrawal({ currentUser, params: { id: withdrawalId } }) {
  const [rows] = await sequelize.query(`SELECT ${columns} FROM gift_withdrawals WHERE public_id=:id AND fk_user_id=:user`, {
    replacements: { id: withdrawalId, user: currentUser.pk_user_id },
  })
  if (!rows[0]) throw createHttpError(404, 'Withdrawal not found', 'NOT_FOUND')
  return { payload: { ok: true, job: mapJob(rows[0]), wallet: await walletPayload(currentUser.pk_user_id) } }
}

/** giftId is the internal key when the caller has already resolved body.id. */
export async function queueGiftWithdrawal({ currentUser, body, giftId = null }) {
  if (!body.request_key) throw createHttpError(400, 'Request key is required', 'REQUEST_KEY_REQUIRED')
  giftId ??= await resolveInternalId(Gift, 'pk_gift_id', body.id)
  let wallet = null
  const result = await sequelize.transaction(async transaction => {
    const replacements = { gift: giftId, user: currentUser.pk_user_id, key: body.request_key }
    // Every trade and withdrawal takes the same gift lock before reading ownership.
    await lockGift(giftId, transaction)
    await assertGiftNotBlocked(giftId, transaction)
    const [prior] = await sequelize.query(`SELECT ${columns} FROM gift_withdrawals
      WHERE fk_user_id=:user AND request_key=:key`, { replacements, transaction })
    if (prior[0]) {
      if (String(prior[0].gift_id) !== String(giftId)) throw createHttpError(409, 'Request key was used for another gift', 'IDEMPOTENCY_CONFLICT')
      return response(prior[0])
    }
    const owner = await Ownership.findOne({ where: { fk_gift_id: giftId, fk_user_id: currentUser.pk_user_id }, transaction, lock: transaction.LOCK.UPDATE })
    if (!owner) throw createHttpError(403, 'Gift does not belong to current user', 'FORBIDDEN')
    const [active] = await sequelize.query(`SELECT ${columns} FROM gift_withdrawals
      WHERE fk_gift_id=:gift AND fk_user_id=:user AND status IN (${activeStatusesSql})`, { replacements, transaction })
    if (active[0]) return response(active[0])
    if (String(body.expected_fee_nano) !== String(GIFT_WITHDRAWAL_FEE_NANO)) {
      throw createHttpError(409, `Confirm the ${feeLabel} withdrawal fee`, 'WITHDRAWAL_FEE_CHANGED')
    }
    await assertGiftInCustody(giftId, transaction)
    const custodian = custodySettings().telegramUserId
    const [deposits] = await sequelize.query(`SELECT pk_deposit_id, status FROM telegram_gift_deposits
      WHERE fk_gift_id=:gift AND custodian_telegram_id=:custodian ORDER BY message_id DESC LIMIT 1`, {
      replacements: { ...replacements, custodian }, transaction,
    })
    const deposit = deposits[0]
    if (!deposit || deposit.status !== 'credited') throw createHttpError(409, 'Verified deposit is required', 'DEPOSIT_REQUIRED')
    // Receipt dates are historical hints. Only Telegram's transfer RPC can
    // reject the current transfer; the worker refreshes terms before sending.
    const user = await User.findByPk(owner.fk_user_id, { transaction })
    if (String(user.telegram_id) === String(custodian)) throw createHttpError(409, 'Cannot withdraw to the custodian', 'INVALID_RECIPIENT')
    const lockedTrade = await lockTradeWallets({ giftId, buyerPkUserId: owner.fk_user_id, sellerPkUserId: owner.fk_user_id, transaction })
    wallet = lockedTrade.sellerWallet
    if (wallet.currency_code !== APP_CURRENCY) throw createHttpError(409, `Withdrawal requires a ${APP_CURRENCY} wallet`, 'INVALID_CURRENCY')
    const balance = walletNano(wallet)
    if (balance.available < GIFT_WITHDRAWAL_FEE_NANO) {
      throw createHttpError(409, `At least ${feeLabel} available balance is required`, 'INSUFFICIENT_BALANCE')
    }
    setWalletNano(wallet, { available: balance.available - GIFT_WITHDRAWAL_FEE_NANO, locked: balance.locked + GIFT_WITHDRAWAL_FEE_NANO })
    await wallet.save({ transaction })
    const feeTransaction = await WalletTransaction.create({
      fk_user_id: owner.fk_user_id, tx_kind: 'gift_withdrawal_fee', direction: 'debit', status: 'pending',
      amount_nano: String(GIFT_WITHDRAWAL_FEE_NANO), fee_nano: 0,
      balance_before_nano: wallet.total_nano, balance_after_nano: wallet.total_nano,
      fk_gift_id: giftId, note: 'Gift withdrawal fee',
    }, { transaction })
    await rejectPendingOffersForGift({ giftId, transaction, lockedTrade })
    await closeActiveGiftListing({ giftId, status: 'canceled', closedReason: 'withdrawal_requested', transaction })
    const [rows] = await sequelize.query(`INSERT INTO gift_withdrawals
      (fk_gift_id,fk_deposit_id,fk_user_id,request_key,fee_nano,fk_fee_wallet_tx_id)
      VALUES (:gift,:deposit,:user,:key,:fee,:feeTransaction) RETURNING ${columns}`, {
      replacements: { ...replacements, deposit: deposit.pk_deposit_id,
        fee: String(GIFT_WITHDRAWAL_FEE_NANO), feeTransaction: feeTransaction.pk_wallet_tx_id }, transaction,
    })
    return response(rows[0])
  })
  invalidateFiltersCatalogCache()
  // A new job has the wallet locked above; a replayed job reads it now.
  result.payload.wallet = wallet ? mapWalletPayload(wallet) : await walletPayload(currentUser.pk_user_id)
  return result
}
