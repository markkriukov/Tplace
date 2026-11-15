import { randomUUID } from 'node:crypto'
import { Op } from 'sequelize'
import { sequelize, withoutTimeouts } from '../../../db/sequelize.js'
import { ADVISORY_LOCKS } from '../../../db/advisory-locks.js'
import { TonPayment, WalletTransaction } from '../../../db/models.js'
import { createHttpError } from '../../../http/errors.js'
import { startPollingWorker } from '../../../polling-worker.js'
import { getOrCreateWallet } from '../wallet-ledger.service.js'
import { MAX_NANO, parseAmountToNano, setWalletNano, walletNano } from '../wallet-money.utils.js'
import { mapWalletPayload } from '../wallet.mapper.js'
import { getTonConfig, normalizeAddress, friendlyAddress } from '../ton/ton.config.js'
import { commentCell, createTonGateway, inboundTransfer, matchesReceipt, MAX_PAYOUT_BATCH } from '../ton/ton.gateway.js'
import { logError } from '../../../log.js'

// A deposit invoice can be signed for this long after it is created.
const INVOICE_TTL_SECONDS = 600
// A late receipt can still settle an unsigned invoice for this long; it then expires.
const INVOICE_EXPIRY_GRACE_SECONDS = 86_400
// Transfers below this are not recorded when they name no invoice: anyone can
// send dust with arbitrary comments to a public address.
const UNMATCHED_DUST_NANO = 10_000_000n
// Seconds after a payout BOC expires before its seqno decides its fate.
const PAYOUT_EXPIRY_MARGIN_SECONDS = 120

function mapPaymentPayload(payment) {
  return {
    id: payment.public_id, kind: payment.kind, status: payment.status,
    amount_nano: String(payment.amount_nano), fee_nano: String(payment.fee_nano),
    total_nano: (BigInt(payment.amount_nano) + BigInt(payment.fee_nano)).toString(),
    wallet_address: friendlyAddress(payment.wallet_address, payment.network),
    network: payment.network, tx_hash: payment.tx_hash,
    ...(payment.kind === 'deposit' && payment.status === 'pending' ? {
      transaction: {
        validUntil: Number(payment.valid_until), network: payment.network,
        from: payment.wallet_address,
        messages: [{ address: friendlyAddress(payment.treasury_address, payment.network),
          amount: String(payment.amount_nano), payload: commentCell(payment.memo).toBoc().toString('base64') }],
      },
    } : {}),
  }
}

const paymentResponseAttributes = ['public_id', 'kind', 'status', 'amount_nano', 'fee_nano', 'wallet_address', 'network', 'tx_hash', 'valid_until', 'treasury_address', 'memo']
const payoutsEnabled = (config) => Boolean(config.mnemonic) && config.payoutsEnabled !== false

export async function paymentOverview(userId) {
  const config = getTonConfig()
  const payments = await TonPayment.findAll({
    attributes: paymentResponseAttributes,
    where: { fk_user_id: userId }, order: [['pk_payment_id', 'DESC']], limit: 25,
  })
  return {
    ton: { network: config.network, deposits_enabled: Boolean(config.address),
      withdrawals_enabled: Boolean(config.address) && payoutsEnabled(config), withdraw_fee_nano: config.feeNano },
    payments: payments.map(mapPaymentPayload),
  }
}

export async function createPayment({ currentUser, body }, kind, config = getTonConfig()) {
  const total = parseAmountToNano(body.amount)
  if (total == null) throw createHttpError(400, 'Enter a positive amount with at most 9 decimals', 'INVALID_AMOUNT')
  if (body.network !== config.network) throw createHttpError(400, 'Switch your wallet to the configured network', 'TON_NETWORK_MISMATCH')
  let address
  try { address = normalizeAddress(body.wallet_address, config.network) }
  catch { throw createHttpError(400, 'Invalid wallet address', 'TON_ADDRESS_INVALID') }
  if (!config.address || (kind === 'withdraw' && !payoutsEnabled(config))) {
    throw createHttpError(503, 'Transfers are not configured yet', 'TON_NOT_CONFIGURED')
  }
  if (address === config.address) throw createHttpError(400, 'Use a personal wallet', 'TON_ADDRESS_INVALID')
  const idempotencyKey = `ton:${currentUser.pk_user_id}:${body.idempotency_key}`
  return sequelize.transaction(async (transaction) => {
    const wallet = await getOrCreateWallet(currentUser.pk_user_id, transaction)
    const existing = await TonPayment.findOne({ where: { idempotency_key: idempotencyKey }, transaction })
    if (existing) {
      const ledger = await WalletTransaction.findByPk(existing.fk_wallet_tx_id, { transaction })
      // Older requests entered the net amount. Retain that meaning on retries;
      // new requests record the entered total independently of later fee changes.
      const originalAmount = ledger?.meta?.requested_amount_nano ?? existing.amount_nano
      if (existing.kind !== kind || BigInt(originalAmount) !== total || existing.wallet_address !== address || existing.network !== config.network) {
        throw createHttpError(409, 'Idempotency key was used for another operation', 'IDEMPOTENCY_CONFLICT')
      }
      return { payload: { ok: true, wallet: mapWalletPayload(wallet), payment: mapPaymentPayload(existing) } }
    }
    const fee = kind === 'withdraw' ? BigInt(config.feeNano) : 0n
    // amount_nano always denotes the on-chain transfer, including legacy rows.
    const amountNano = total - fee
    const balance = walletNano(wallet)
    if (kind === 'withdraw') {
      if (amountNano <= 0n) throw createHttpError(400, 'Withdrawal amount must exceed the included fee', 'AMOUNT_BELOW_FEE')
      if (balance.available < total) throw createHttpError(400, 'Insufficient balance', 'INSUFFICIENT_BALANCE')
      setWalletNano(wallet, { available: balance.available - total, locked: balance.locked + total })
      await wallet.save({ transaction })
    } else if (balance.total + total > MAX_NANO) {
      throw createHttpError(400, 'Balance exceeds the supported limit', 'INVALID_AMOUNT')
    }
    const ledger = await WalletTransaction.create({
      fk_user_id: currentUser.pk_user_id, tx_kind: kind, direction: kind === 'deposit' ? 'credit' : 'debit',
      status: 'pending', amount_nano: String(amountNano), fee_nano: fee.toString(),
      balance_before_nano: wallet.total_nano, idempotency_key: idempotencyKey,
      meta: { requested_amount_nano: total.toString() },
    }, { transaction })
    const payment = await TonPayment.create({
      fk_user_id: currentUser.pk_user_id, fk_wallet_tx_id: ledger.pk_wallet_tx_id, idempotency_key: idempotencyKey,
      kind, status: kind === 'deposit' ? 'pending' : 'queued', network: config.network,
      treasury_address: config.address, wallet_address: address, amount_nano: String(amountNano), fee_nano: fee.toString(),
      memo: `tplace:${kind}:${randomUUID()}`, valid_until: Math.floor(Date.now() / 1000) + INVOICE_TTL_SECONDS,
    }, { transaction })
    return { statusCode: 202, payload: { ok: true, wallet: mapWalletPayload(wallet), payment: mapPaymentPayload(payment) } }
  })
}

export async function getPayment({ currentUser, params: { id: paymentId } }) {
  const payment = await TonPayment.findOne({ attributes: paymentResponseAttributes, where: { public_id: paymentId, fk_user_id: currentUser.pk_user_id } })
  if (!payment) throw createHttpError(404, 'Payment not found', 'NOT_FOUND')
  const wallet = await getOrCreateWallet(currentUser.pk_user_id)
  return { payload: { ok: true, payment: mapPaymentPayload(payment), wallet: mapWalletPayload(wallet) } }
}

const expiredBefore = () => Math.floor(Date.now() / 1000) - INVOICE_EXPIRY_GRACE_SECONDS

export async function expirePayment(paymentId) {
  return sequelize.transaction(async transaction => {
    const payment = await TonPayment.findByPk(paymentId, { transaction, lock: transaction.LOCK.UPDATE })
    if (!payment || payment.kind !== 'deposit' || payment.status !== 'pending' ||
        Number(payment.valid_until) + INVOICE_EXPIRY_GRACE_SECONDS >= Date.now() / 1000) return
    await payment.update({ status: 'expired', updated_at: new Date() }, { transaction })
    await WalletTransaction.update({ status: 'canceled', finalized_at: new Date() }, {
      where: { pk_wallet_tx_id: payment.fk_wallet_tx_id }, transaction,
    })
  })
}

// Resolves to 'balance_limit', changing nothing, when crediting a deposit would
// exceed the supported balance; the payment then needs manual reconciliation.
export async function settlePayment(paymentId, txHash) {
  return sequelize.transaction(async (transaction) => {
    const payment = await TonPayment.findByPk(paymentId, { transaction, lock: transaction.LOCK.UPDATE })
    if (!payment || payment.status === 'completed') return
    const wallet = await getOrCreateWallet(payment.fk_user_id, transaction)
    const before = walletNano(wallet)
    const amount = BigInt(payment.amount_nano)
    if (payment.kind === 'deposit') {
      if (before.total + amount > MAX_NANO) return 'balance_limit'
      setWalletNano(wallet, { available: before.available + amount, locked: before.locked })
    } else {
      const debit = amount + BigInt(payment.fee_nano)
      if (before.locked < debit) throw new Error('Missing withdrawal reservation')
      setWalletNano(wallet, { available: before.available, locked: before.locked - debit })
    }
    await wallet.save({ transaction })
    await WalletTransaction.update({ status: 'completed', external_ref: txHash, finalized_at: new Date(),
      balance_before_nano: before.total.toString(), balance_after_nano: wallet.total_nano,
    }, { where: { pk_wallet_tx_id: payment.fk_wallet_tx_id }, transaction })
    await payment.update({ status: 'completed', tx_hash: txHash, updated_at: new Date() }, { transaction })
  })
}

async function readScanCursor(scope) {
  const [rows] = await sequelize.query('SELECT last_lt::text AS lt FROM ton_scan_cursors WHERE network=:network AND address=:address',
    { replacements: { network: scope.network, address: scope.treasury_address } })
  return rows[0]?.lt ?? null
}

async function saveScanCursor(scope, tx) {
  await sequelize.query(`INSERT INTO ton_scan_cursors(network, address, last_lt, last_hash) VALUES (:network, :address, :lt, :hash)
    ON CONFLICT (network, address) DO UPDATE SET last_lt=EXCLUDED.last_lt, last_hash=EXCLUDED.last_hash, updated_at=now()
    WHERE ton_scan_cursors.last_lt < EXCLUDED.last_lt`,
  { replacements: { network: scope.network, address: scope.treasury_address, lt: tx.lt.toString(), hash: tx.hash().toString('hex') } })
}

// Settle the invoice a transfer names, or record why it could not be credited.
async function processIncomingTransfer(tx, scope) {
  const transfer = inboundTransfer(tx, scope.treasury_address)
  if (!transfer) return 'ignored'
  const payment = transfer.memo == null ? null : await TonPayment.findOne({
    where: { ...scope, kind: 'deposit', memo: transfer.memo },
  })
  if (payment?.status === 'completed' && payment.tx_hash === transfer.hash) return 'settled'
  let reason = null
  if (payment?.status === 'pending' && matchesReceipt(tx, payment)) {
    // Throwing here would stop the scan at this transfer and halt every later deposit.
    if (await settlePayment(payment.pk_payment_id, transfer.hash) !== 'balance_limit') return 'settled'
    reason = 'balance_limit'
  }
  if (!payment && transfer.amount < UNMATCHED_DUST_NANO) return 'ignored'
  reason ??= !payment ? 'unknown_memo' : payment.status === 'expired' ? 'payment_expired'
    : payment.status === 'completed' ? 'payment_settled_elsewhere' : 'payment_mismatch'
  const [inserted] = await sequelize.query(`INSERT INTO ton_unmatched_deposits(network, treasury_address, tx_hash, tx_lt, received_at,
      sender_address, amount_nano, memo, fk_payment_id, reason)
    VALUES (:network, :treasury, :hash, :lt, to_timestamp(:now), :sender, :amount, :memo, :paymentId, :reason)
    ON CONFLICT (network, tx_hash) DO NOTHING RETURNING pk_unmatched_deposit_id`, { replacements: {
    network: scope.network, treasury: scope.treasury_address, hash: transfer.hash, lt: transfer.lt.toString(), now: transfer.now,
    sender: transfer.sender, amount: transfer.amount.toString(), memo: transfer.memo?.slice(0, 512) ?? null,
    paymentId: payment?.pk_payment_id ?? null, reason,
  } })
  if (inserted.length) {
    console.error(JSON.stringify({ event: 'ton_unmatched_deposit', reason, tx_hash: transfer.hash,
      amount_nano: transfer.amount.toString(), payment_id: payment?.public_id ?? null }))
  }
  return 'unmatched'
}

// One pass over treasury history since the durable cursor replaces a history
// scan per invoice. Without a cursor, start just before the oldest open invoice.
async function scanTreasury(scope, gateway) {
  const afterLt = await readScanCursor(scope)
  let sinceSeconds = 0
  if (afterLt == null) {
    const oldest = await TonPayment.min('created_at', { where: { ...scope, kind: 'deposit', status: 'pending' } })
    sinceSeconds = Math.floor(new Date(oldest ?? Date.now()).getTime() / 1000) - 30
  }
  const { transactions, head } = await gateway.scanIncoming(scope.treasury_address, { afterLt, sinceSeconds })
  for (const tx of transactions) {
    await processIncomingTransfer(tx, scope)
    await saveScanCursor(scope, tx)
  }
  if (afterLt == null && !transactions.length && head) await saveScanCursor(scope, head)
}

// The outer transaction holds only a cross-process advisory lock. Prepared BOCs
// commit in a separate transaction BEFORE sending, so a crash retries the same
// signed message and seqno, never a new transfer.
export async function reconcilePayments({ config = getTonConfig(), gateway = createTonGateway(config) } = {}) {
  if (!config.address) return
  await sequelize.transaction(async (lockTransaction) => {
    // This transaction idles through the RPC calls of the whole pass.
    await withoutTimeouts(lockTransaction)
    const [rows] = await sequelize.query('SELECT pg_try_advisory_xact_lock(:key) AS acquired',
      { replacements: { key: ADVISORY_LOCKS.tonPayments }, transaction: lockTransaction })
    if (!rows[0].acquired) return
    const scope = { network: config.network, treasury_address: config.address }
    // A failed scan leaves the cursor in place; expiry must then wait, or an
    // invoice could expire while its receipt is still unread.
    let scanned = false
    try {
      await scanTreasury(scope, gateway)
      scanned = true
    } catch (error) {
      logError('ton_treasury_scan_retry', error)
    }
    if (scanned) {
      const overdue = await TonPayment.findAll({
        attributes: ['pk_payment_id', 'public_id'],
        where: { ...scope, kind: 'deposit', status: 'pending', valid_until: { [Op.lt]: expiredBefore() } },
        order: [['pk_payment_id', 'ASC']], limit: 100,
      })
      for (const payment of overdue) {
        try { await expirePayment(payment.pk_payment_id) }
        catch (error) { logError('ton_expiry_retry', error, { payment_id: payment.public_id }) }
      }
    }
    await reconcilePayouts(scope, gateway)
    if (!payoutsEnabled(config)) return
    await sendNextPayoutBatch(scope, gateway, config.payoutBatchSize ?? MAX_PAYOUT_BATCH)
  })
}

// Settle, rebroadcast or resolve every unconfirmed payout. Rows of one batch
// share a signed BOC and seqno.
async function reconcilePayouts(scope, gateway) {
  const active = await TonPayment.findAll({
    where: { ...scope, kind: 'withdraw', status: { [Op.in]: ['broadcast', 'review'] } },
    order: [['updated_at', 'ASC']], limit: 30,
  })
  const rebroadcast = new Set()
  let currentSeqno
  for (const payment of active) {
    try {
      const hash = await gateway.findReceipt(payment)
      if (hash) { await settlePayment(payment.pk_payment_id, hash); continue }
      if (payment.status !== 'broadcast') continue
      const now = Date.now() / 1000
      if (Number(payment.valid_until) > now) {
        if (!rebroadcast.has(payment.signed_boc)) {
          rebroadcast.add(payment.signed_boc)
          await gateway.broadcast(payment)
        }
        continue
      }
      // Let the chain and RPC catch up before judging an expired transfer.
      if (now < Number(payment.valid_until) + PAYOUT_EXPIRY_MARGIN_SECONDS) continue
      currentSeqno ??= payment.seqno == null ? undefined : await gateway.getSeqno()
      if (payment.seqno != null && currentSeqno <= Number(payment.seqno)) {
        // The wallet never used this seqno and the BOC has expired, so it can
        // never execute: queue the payout to be signed again.
        await payment.update({ status: 'queued', signed_boc: null, seqno: null })
        console.warn(JSON.stringify({ event: 'ton_payout_requeued', payment_id: payment.public_id }))
      } else {
        // Executed (or legacy without seqno) but unproven: never refund or
        // re-sign. A late receipt can still settle it. Other payouts continue.
        await payment.update({ status: 'review' })
        console.error(JSON.stringify({ event: 'ton_payment_review_required', payment_id: payment.public_id }))
      }
    } catch (error) {
      logError('ton_reconcile_retry', error, { payment_id: payment.public_id })
    } finally { await payment.update({ updated_at: new Date() }) }
  }
}

// One signed batch is in flight at a time, so its seqno identifies it. Rows in
// review used older seqnos and no longer block the queue.
async function sendNextPayoutBatch(scope, gateway, batchSize) {
  if (await TonPayment.count({ where: { ...scope, kind: 'withdraw', status: 'broadcast' } })) return
  const queued = await TonPayment.findAll({
    where: { ...scope, kind: 'withdraw', status: 'queued' }, order: [['pk_payment_id', 'ASC']],
    limit: Math.min(Math.max(batchSize, 1), MAX_PAYOUT_BATCH),
  })
  if (!queued.length) return
  let batch = []
  try {
    const signed = await gateway.prepareWithdrawal(queued)
    batch = queued.slice(0, signed.count ?? queued.length)
    // Commit the signed BOC for the whole batch BEFORE sending it.
    await sequelize.transaction(async transaction => {
      for (const payment of batch) {
        await payment.update({ signed_boc: signed.signed_boc, valid_until: signed.valid_until,
          seqno: signed.seqno ?? null, status: 'broadcast', updated_at: new Date() }, { transaction })
      }
    })
    await gateway.broadcast(batch[0])
  } catch (error) {
    logError('ton_payout_retry', error, { payment_ids: (batch.length ? batch : queued).map(payment => payment.public_id) })
  }
}

export function startPaymentWorker() {
  const config = getTonConfig()
  if (!config.address) return async () => {}
  const gateway = createTonGateway(config)
  return startPollingWorker(() => reconcilePayments({ config, gateway }), { intervalMs: 10_000, errorEvent: 'ton_worker_retry' })
}
