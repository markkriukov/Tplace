import { Address, beginCell, Cell, internal, SendMode } from '@ton/core'
import { getTonConfig } from './ton.config.js'
import { deriveTreasurySigner } from './ton.signer.js'
import { createTonRpcClient } from './ton.rpc.js'

export function commentCell(memo) {
  return beginCell().storeUint(0, 32).storeStringTail(memo).endCell()
}

// Only a proven native-currency receipt can settle a payment. A wallet's
// sendTransaction response (BOC) is deliberately never accepted as payment proof.
export function matchesReceipt(tx, payment) {
  const message = tx.inMessage
  const info = message?.info
  const description = tx.description
  if (info?.type !== 'internal' || info.bounced || description?.type !== 'generic') return false
  // A first non-bounceable transfer is credited at protocol level even though
  // no wallet code exists yet (compute is skipped and aborted is true).
  // Accept only this precise no-state case, never a generic failed execution.
  if (!['deposit', 'withdraw'].includes(payment.kind)) return false
  const creditedUninitializedTransfer = info.bounce === false &&
    ['non-existing', 'uninitialized'].includes(tx.oldStatus) && tx.endStatus === 'uninitialized' &&
    description.computePhase?.type === 'skipped' && description.computePhase.reason === 'no-state' &&
    description.creditPhase?.credit.coins === BigInt(payment.amount_nano) &&
    !description.actionPhase && !description.bouncePhase && !description.destroyed && tx.outMessagesCount === 0
  if (!creditedUninitializedTransfer) {
    if (description.aborted || description.computePhase?.type !== 'vm' || !description.computePhase.success) return false
    if (description.actionPhase && !description.actionPhase.success) return false
  }
  const sender = payment.kind === 'deposit' ? payment.wallet_address : payment.treasury_address
  const recipient = payment.kind === 'deposit' ? payment.treasury_address : payment.wallet_address
  if (!info.src.equals(Address.parse(sender)) || !info.dest.equals(Address.parse(recipient))) return false
  if (info.value.coins !== BigInt(payment.amount_nano)) return false
  if (tx.now < Math.floor(new Date(payment.created_at).getTime() / 1000) - 30) return false
  return readComment(message.body) === payment.memo
}

function readComment(body) {
  try {
    const slice = body.beginParse()
    return slice.loadUint(32) === 0 ? slice.loadStringTail() : null
  } catch { return null }
}

// An inbound native transfer that the treasury kept. Bounced, external and
// zero-value messages, and transfers returned by the bounce phase, carry no funds.
export function inboundTransfer(tx, treasuryAddress) {
  const info = tx.inMessage?.info
  if (info?.type !== 'internal' || info.bounced || tx.description?.type !== 'generic') return null
  if (tx.description.bouncePhase || !info.dest.equals(Address.parse(treasuryAddress))) return null
  if (info.value.coins <= 0n) return null
  return {
    hash: tx.hash().toString('hex'), lt: tx.lt, now: tx.now,
    sender: info.src.toRawString(), amount: info.value.coins, memo: readComment(tx.inMessage.body),
  }
}

export const MAX_SCAN_PAGES = 50
export const MAX_PAYOUT_BATCH = 4
// Per-message allowance for forwarding fees when checking the treasury balance.
const PAYOUT_GAS_RESERVE_NANO = 50_000_000n
// A signed payout can execute for this long.
const PAYOUT_TTL_SECONDS = 600

/** The RPC pages history back from a transaction's predecessor: its logical time and base64 hash. */
const previousPage = (tx) => ({
  lt: tx.prevTransactionLt.toString(),
  hash: Buffer.from(tx.prevTransactionHash.toString(16).padStart(64, '0'), 'hex').toString('base64'),
})

export function createTonGateway(config = getTonConfig(), client = createTonRpcClient(config)) {
  let signerPromise
  const signer = () => {
    signerPromise ??= (async () => {
      const { keys, contract } = await deriveTreasurySigner(config)
      return { wallet: client.open(contract), keys }
    })()
    return signerPromise
  }
  return {
    async findReceipt(payment) {
      const recipient = payment.kind === 'deposit' ? payment.treasury_address : payment.wallet_address
      const since = Math.floor(new Date(payment.created_at).getTime() / 1000) - 30
      let cursor = {}
      // Bound work per attempt; never interpret an incomplete scan as failure.
      for (let page = 0; page < 20; page++) {
        const rows = await client.getTransactions(Address.parse(recipient), { limit: 100, archival: true, inclusive: true, ...cursor })
        for (const tx of rows) {
          if (matchesReceipt(tx, payment)) return tx.hash().toString('hex')
        }
        const last = rows.at(-1)
        if (!last || last.now < since || last.prevTransactionLt === 0n) return null
        cursor = previousPage(last)
      }
      throw new Error('Receipt scan incomplete; keep the payment pending')
    },
    // Transactions newer than afterLt (or, without a cursor, not older than
    // sinceSeconds), oldest first, plus the account head. An incomplete scan
    // throws so the cursor never skips history.
    async scanIncoming(address, { afterLt = null, sinceSeconds = 0 } = {}) {
      const account = Address.parse(address)
      const collected = []
      let head = null
      let cursor = {}
      for (let page = 0; page < MAX_SCAN_PAGES; page++) {
        const rows = await client.getTransactions(account, {
          limit: 100, archival: true, inclusive: true, ...cursor,
          ...(afterLt != null ? { to_lt: String(afterLt) } : {}),
        })
        head ??= rows[0] ?? null
        let reached = false
        for (const tx of rows) {
          if (afterLt != null ? tx.lt <= BigInt(afterLt) : tx.now < sinceSeconds) { reached = true; break }
          collected.push(tx)
        }
        const last = rows.at(-1)
        if (reached || !last || last.prevTransactionLt === 0n || rows.length < 100) return { transactions: collected.reverse(), head }
        cursor = previousPage(last)
      }
      throw new Error('Treasury scan exceeded MAX_SCAN_PAGES; the cursor was not advanced')
    },
    // Sign one transfer for the longest queue prefix the treasury can cover,
    // at most MAX_PAYOUT_BATCH messages (the V4/V5 wallet limit used here).
    async prepareWithdrawal(payments) {
      const { wallet, keys } = await signer()
      const seqno = await wallet.getSeqno()
      // V4's first transfer has no useful expiry. Require an initialized wallet.
      if (seqno === 0) throw new Error('Initialize the treasury wallet before enabling withdrawals')
      let available = await wallet.getBalance()
      const batch = []
      for (const payment of payments.slice(0, MAX_PAYOUT_BATCH)) {
        const cost = BigInt(payment.amount_nano) + PAYOUT_GAS_RESERVE_NANO
        if (available < cost) break
        available -= cost
        batch.push(payment)
      }
      if (!batch.length) throw new Error('Treasury balance is insufficient')
      const validUntil = Math.floor(Date.now() / 1000) + PAYOUT_TTL_SECONDS
      const transfer = wallet.createTransfer({
        seqno, secretKey: keys.secretKey, timeout: validUntil,
        sendMode: SendMode.PAY_GAS_SEPARATELY | SendMode.IGNORE_ERRORS,
        messages: batch.map(payment => internal({
          to: Address.parse(payment.wallet_address), value: BigInt(payment.amount_nano), bounce: false, body: commentCell(payment.memo),
        })),
      })
      return { signed_boc: transfer.toBoc().toString('base64'), valid_until: validUntil, seqno, count: batch.length }
    },
    async getSeqno() {
      const { wallet } = await signer()
      return wallet.getSeqno()
    },
    async broadcast(payment) {
      const { wallet } = await signer()
      await wallet.send(Cell.fromBase64(payment.signed_boc))
    },
  }
}
