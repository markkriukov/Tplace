import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { Address } from '@ton/core'
import { Blockchain } from '@ton/sandbox'
import { matchesReceipt, commentCell } from '../src/modules/wallet/ton/ton.gateway.js'
import { normalizeAddress } from '../src/modules/wallet/ton/ton.config.js'

const userAddress = '0:' + '22'.repeat(32)
const treasuryAddress = '0:' + '11'.repeat(32)

test('only an exact, successful native GRAM receipt proves a payment', () => {
  const payment = { kind: 'deposit', wallet_address: userAddress, treasury_address: treasuryAddress,
    amount_nano: '1000000001', memo: 'tplace:deposit:unique', created_at: new Date() }
  const receipt = () => ({
    now: Math.floor(Date.now() / 1000),
    inMessage: { info: { type: 'internal', bounced: false, src: Address.parse(userAddress),
      dest: Address.parse(treasuryAddress), value: { coins: 1000000001n } }, body: commentCell(payment.memo) },
    description: { type: 'generic', aborted: false, computePhase: { type: 'vm', success: true }, actionPhase: { success: true } },
  })
  assert.equal(matchesReceipt(receipt(), payment), true)
  const changes = [
    (tx) => { tx.inMessage.info.bounced = true },
    (tx) => { tx.description.aborted = true },
    (tx) => { tx.description.computePhase.success = false },
    (tx) => { tx.description.actionPhase.success = false },
    (tx) => { tx.inMessage.info.value.coins = 1n },
    (tx) => { tx.inMessage.info.src = Address.parse(treasuryAddress) },
    (tx) => { tx.inMessage.info.dest = Address.parse(userAddress) },
    (tx) => { tx.inMessage.body = commentCell('another-invoice') },
    (tx) => { tx.now -= 1000 },
    (tx) => { tx.inMessage.info.type = 'external-in' },
  ]
  for (const change of changes) { const tx = receipt(); change(tx); assert.equal(matchesReceipt(tx, payment), false) }
  const payout = receipt()
  payout.inMessage.info.src = Address.parse(treasuryAddress)
  payout.inMessage.info.dest = Address.parse(userAddress)
  assert.equal(matchesReceipt(payout, { ...payment, kind: 'withdraw' }), true)
  assert.throws(() => normalizeAddress(Address.parse(userAddress).toString({ testOnly: true }), '-239'))
  assert.equal(normalizeAddress(userAddress, '-3'), userAddress)
})

test('first non-bounceable deposits and withdrawals are credited in the TON emulator', async () => {
  const blockchain = await Blockchain.create()
  const sender = await blockchain.treasury('depositor')
  const destination = Address.parse(treasuryAddress)
  const payment = { kind: 'deposit', wallet_address: sender.address.toRawString(), treasury_address: treasuryAddress,
    amount_nano: '1000000001', memo: 'tplace:deposit:first-payment', created_at: new Date() }
  const result = await sender.send({ to: destination, value: 1000000001n, bounce: false, body: commentCell(payment.memo) })
  const receipt = result.transactions.find((tx) => tx.inMessage?.info.type === 'internal' && tx.inMessage.info.dest.equals(destination))
  assert.ok(receipt)
  assert.ok(['non-existing', 'uninitialized'].includes(receipt.oldStatus))
  assert.equal(receipt.endStatus, 'uninitialized')
  assert.equal(receipt.description.aborted, true)
  assert.equal(receipt.description.computePhase.reason, 'no-state')
  assert.equal(receipt.description.creditPhase.credit.coins, 1000000001n)
  assert.equal(matchesReceipt(receipt, payment), true)
  assert.equal(matchesReceipt(receipt, { ...payment, kind: 'withdraw' }), false)
  const withdrawal = { ...payment, kind: 'withdraw',
    treasury_address: payment.wallet_address, wallet_address: payment.treasury_address }
  assert.equal(matchesReceipt(receipt, withdrawal), true)
  assert.equal(matchesReceipt(receipt, { ...withdrawal, kind: 'unknown' }), false)
  assert.equal(matchesReceipt(receipt, { ...payment, amount_nano: '2' }), false)
  assert.equal(matchesReceipt(receipt, { ...payment, memo: 'another-invoice' }), false)
  const invalid = [
    { ...receipt, oldStatus: 'active' },
    { ...receipt, endStatus: 'frozen' },
    { ...receipt, outMessagesCount: 1 },
    { ...receipt, description: { ...receipt.description, creditPhase: null } },
    { ...receipt, description: { ...receipt.description, creditPhase: { credit: { coins: 1n } } } },
    { ...receipt, description: { ...receipt.description, computePhase: { type: 'skipped', reason: 'no-gas' } } },
    { ...receipt, description: { ...receipt.description, bouncePhase: { type: 'ok' } } },
    { ...receipt, description: { ...receipt.description, destroyed: true } },
    { ...receipt, inMessage: { ...receipt.inMessage, info: { ...receipt.inMessage.info, bounce: true } } },
  ]
  for (const tx of invalid) {
    assert.equal(matchesReceipt(tx, payment), false)
    assert.equal(matchesReceipt(tx, withdrawal), false)
  }

  const bouncedTo = Address.parse('0:' + '33'.repeat(32))
  const bounced = await sender.send({ to: bouncedTo, value: 1000000001n, bounce: true, body: commentCell(payment.memo) })
  const failedReceipt = bounced.transactions.find((tx) => tx.inMessage?.info.type === 'internal' && tx.inMessage.info.dest.equals(bouncedTo))
  assert.ok(failedReceipt.description.bouncePhase)
  assert.equal(matchesReceipt(failedReceipt, { ...payment, treasury_address: bouncedTo.toRawString() }), false)
})

test('treasury scan pages back to its cursor, returns oldest first and never skips history', async () => {
  const { createTonGateway, MAX_SCAN_PAGES } = await import('../src/modules/wallet/ton/ton.gateway.js')
  // Account history, newest first, with lt 250..1.
  const history = Array.from({ length: 250 }, (_, index) => {
    const lt = BigInt(250 - index)
    return { lt, now: 1_000 + Number(lt), prevTransactionLt: lt - 1n, prevTransactionHash: lt - 1n }
  })
  const calls = []
  const client = { getTransactions: async (_address, options) => {
    calls.push(options)
    const start = options.lt ? history.findIndex(tx => tx.lt === BigInt(options.lt)) : 0
    return history.slice(start, start + options.limit)
  } }
  const gateway = createTonGateway({ network: '-3' }, client)
  const fromCursor = await gateway.scanIncoming(treasuryAddress, { afterLt: '120' })
  assert.deepEqual(fromCursor.transactions.map(tx => tx.lt), Array.from({ length: 130 }, (_, i) => BigInt(121 + i)))
  assert.equal(fromCursor.head.lt, 250n)
  assert.equal(calls.length, 2)
  assert.equal(calls[1].lt, '150')
  assert.equal(calls[1].hash, Buffer.from((150).toString(16).padStart(64, '0'), 'hex').toString('base64'))
  const bySince = await gateway.scanIncoming(treasuryAddress, { sinceSeconds: 1_245 })
  assert.deepEqual(bySince.transactions.map(tx => tx.lt), [245n, 246n, 247n, 248n, 249n, 250n])
  const endless = { getTransactions: async (_address, options) => {
    const top = options.lt ? BigInt(options.lt) : 1_000_000n
    return Array.from({ length: 100 }, (_, i) => ({ lt: top - BigInt(i), now: 9e9, prevTransactionLt: top - BigInt(i) - 1n, prevTransactionHash: 1n }))
  } }
  await assert.rejects(createTonGateway({ network: '-3' }, endless).scanIncoming(treasuryAddress, { afterLt: '1' }), /MAX_SCAN_PAGES/)
  assert.ok(MAX_SCAN_PAGES >= 20)
})

test('TON invoices, settlement and durable payout retry', { skip: !process.env.TEST_DATABASE_URL }, async (t) => {
  assert.match(new URL(process.env.TEST_DATABASE_URL).pathname, /_test$/)
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL
  const { sequelize } = await import('../src/db/sequelize.js')
  const { migrateDatabase } = await import('../src/db/migrations.js')
  const { User, WalletBalance, WalletTransaction, TonPayment } = await import('../src/db/models.js')
  const paymentKey = async value => typeof value === 'string' && value.includes('-')
    ? (await TonPayment.findOne({ where: { public_id: value } })).pk_payment_id : value
  const findPayment = async value => TonPayment.findByPk(await paymentKey(value))
  const settlePayment = async (value, hash) => settleInternalPayment(await paymentKey(value), hash)
  const expirePayment = async value => expireInternalPayment(await paymentKey(value))

  const { createPayment, settlePayment: settleInternalPayment, expirePayment: expireInternalPayment, reconcilePayments, getPayment } = await import('../src/modules/wallet/payments/payments.service.js')
  await migrateDatabase()
  t.after(() => sequelize.close())
  let nextId = Date.now() * 1000 + 500000
  const fixture = async () => {
    const user = await User.create({ telegram_id: String(nextId++) })
    await WalletBalance.upsert({ fk_user_id: user.pk_user_id, available_nano: '10000000000'})
    // Single-payout batches keep these queue tests about one transfer at a time.
    const config = { network: '-3', address: '0:' + randomBytes(32).toString('hex'), mnemonic: 'mock signer', feeNano: '50000000', payoutBatchSize: 1 }
    const create = (kind, key, amount = '1') => createPayment({ currentUser: user, body: {
      amount, idempotency_key: key, wallet_address: userAddress, network: '-3',
    } }, kind, config)
    const balance = () => WalletBalance.findOne({ where: { fk_user_id: user.pk_user_id } })
    return { user, config, create, balance }
  }
  await t.test('expiry rolls back both statuses on failure and cannot overwrite settlement', async () => {
    const f = await fixture()
    const invoice = await f.create('deposit', 'expiry-atomic')
    const payment = await findPayment(invoice.payload.payment.id)
    await payment.update({ valid_until: Math.floor(Date.now() / 1000) - 86401 })
    const original = WalletTransaction.update
    WalletTransaction.update = async (...args) => {
      await original.apply(WalletTransaction, args)
      throw new Error('Simulated failure after ledger update')
    }
    try { await assert.rejects(expirePayment(payment.pk_payment_id), /Simulated failure/) }
    finally { WalletTransaction.update = original }
    assert.equal((await payment.reload()).status, 'pending')
    assert.equal((await WalletTransaction.findByPk(payment.fk_wallet_tx_id)).status, 'pending')
    await expirePayment(payment.pk_payment_id)
    assert.equal((await payment.reload()).status, 'expired')
    assert.equal((await WalletTransaction.findByPk(payment.fk_wallet_tx_id)).status, 'canceled')
    const another = await f.create('deposit', 'settled-before-expiry')
    const paid = await findPayment(another.payload.payment.id)
    await paid.update({ valid_until: Math.floor(Date.now() / 1000) - 86401 })
    await settlePayment(paid.pk_payment_id, randomBytes(32).toString('hex'))
    await expirePayment(paid.pk_payment_id)
    assert.equal((await paid.reload()).status, 'completed')
    assert.equal((await WalletTransaction.findByPk(paid.fk_wallet_tx_id)).status, 'completed')
  })
  await t.test('invoice and client retries cannot credit funds; receipt settlement is atomic and unique', async () => {
    const f = await fixture()
    const invoices = await Promise.all([1, 2, 3].map(() => f.create('deposit', 'same')))
    assert.equal(new Set(invoices.map((r) => r.payload.payment.id)).size, 1)
    assert.equal((await f.balance()).total_nano, '10000000000')
    const id = invoices[0].payload.payment.id
    const hash = randomBytes(32).toString('hex')
    await Promise.all([settlePayment(id, hash), settlePayment(id, hash)])
    assert.equal((await f.balance()).available_nano, '11000000000')
    const another = await f.create('deposit', 'another')
    await assert.rejects(settlePayment(another.payload.payment.id, hash))
    assert.equal((await f.balance()).available_nano, '11000000000')
    assert.equal((await findPayment(another.payload.payment.id)).status, 'pending')
    await assert.rejects(getPayment({ currentUser: { pk_user_id: -1 }, params: { id } }), { statusCode: 404 })
    const ledger = await WalletTransaction.findOne({ where: { fk_user_id: f.user.pk_user_id, status: 'completed' } })
    assert.equal(ledger.external_ref, hash)
  })
  await t.test('0.1 withdrawal includes its 0.05 fee, pays 0.05 and settles only the entered total', async () => {
    const f = await fixture()
    const result = await f.create('withdraw', 'inclusive-fee', '0.1')
    const payment = result.payload.payment
    assert.equal(payment.amount_nano, '50000000')
    assert.equal(payment.fee_nano, '50000000')
    assert.equal(payment.total_nano, '100000000')
    assert.equal((await f.balance()).available_nano, '9900000000')
    assert.equal((await f.balance()).locked_nano, '100000000')
    const ledger = await WalletTransaction.findOne({ where: { fk_user_id: f.user.pk_user_id } })
    assert.equal(ledger.amount_nano, '50000000')
    assert.equal(ledger.meta.requested_amount_nano, '100000000')

    // Retries use the saved input and fee even if the configured fee changes.
    f.config.feeNano = '200000000'
    assert.deepEqual((await f.create('withdraw', 'inclusive-fee', '0.1')).payload.payment, payment)
    await assert.rejects(f.create('withdraw', 'inclusive-fee', '0.2'), { code: 'IDEMPOTENCY_CONFLICT' })
    let sentAmount
    const gateway = {
      scanIncoming: async () => ({ transactions: [], head: null }),
      findReceipt: async () => null,
      prepareWithdrawal: async ([p]) => {
        sentAmount = p.amount_nano
        return { signed_boc: 'synthetic-net-transfer', valid_until: Math.floor(Date.now() / 1000) + 600 }
      },
      broadcast: async () => {},
    }
    await reconcilePayments({ config: f.config, gateway })
    assert.equal(sentAmount, '50000000')
    const hash = randomBytes(32).toString('hex')
    await settlePayment(payment.id, hash)
    await settlePayment(payment.id, hash)
    assert.equal((await f.balance()).total_nano, '9900000000')
    assert.equal((await f.balance()).available_nano, '9900000000')
    assert.equal((await f.balance()).locked_nano, '0')
    await ledger.reload()
    assert.equal(BigInt(ledger.balance_before_nano) - BigInt(ledger.balance_after_nano), 100000000n)
  })
  await t.test('a payout credited to an uninitialized address settles and releases the next payout', async () => {
    const f = await fixture()
    const blockchain = await Blockchain.create()
    const sender = await blockchain.treasury('payout-queue')
    f.config.address = sender.address.toRawString()
    const first = (await f.create('withdraw', 'first-uninitialized')).payload.payment
    const second = (await f.create('withdraw', 'second-uninitialized')).payload.payment
    const receipts = new Map()
    const gateway = {
      scanIncoming: async () => ({ transactions: [], head: null }),
      prepareWithdrawal: async () => ({ signed_boc: 'emulator', valid_until: Math.floor(Date.now() / 1000) + 600 }),
      broadcast: async (p) => {
        const destination = Address.parse(p.wallet_address)
        const result = await sender.send({ to: destination, value: BigInt(p.amount_nano), bounce: false, body: commentCell(p.memo) })
        const receipt = result.transactions.find(tx => tx.inMessage?.info.type === 'internal' && tx.inMessage.info.dest.equals(destination))
        assert.equal(receipt.endStatus, 'uninitialized')
        receipts.set(String(p.pk_payment_id), receipt)
      },
      findReceipt: async (p) => {
        const receipt = receipts.get(String(p.pk_payment_id))
        return receipt && matchesReceipt(receipt, p) ? receipt.hash().toString('hex') : null
      },
    }
    await reconcilePayments({ config: f.config, gateway })
    await reconcilePayments({ config: f.config, gateway })
    assert.equal((await findPayment(first.id)).status, 'completed')
    assert.equal((await findPayment(second.id)).status, 'broadcast')
    await reconcilePayments({ config: f.config, gateway })
    assert.equal((await findPayment(second.id)).status, 'completed')
    assert.equal((await f.balance()).locked_nano, '0')
  })
  await t.test('withdrawals reject amounts covered by the fee without reserving funds', async () => {
    const f = await fixture()
    for (const amount of ['0.05', '0.049999999', '0.000000001']) {
      await assert.rejects(f.create('withdraw', `small-${amount.replace('.', '-')}`, amount), { code: 'AMOUNT_BELOW_FEE' })
    }
    assert.equal((await f.balance()).available_nano, '10000000000')
    assert.equal((await f.balance()).locked_nano, '0')
    assert.equal(await TonPayment.count({ where: { fk_user_id: f.user.pk_user_id } }), 0)
    assert.equal(await WalletTransaction.count({ where: { fk_user_id: f.user.pk_user_id } }), 0)
    const minimal = (await f.create('withdraw', 'one-nano', '0.050000001')).payload.payment
    assert.equal(minimal.amount_nano, '1')
    assert.equal(minimal.total_nano, '50000001')
  })
  await t.test('the full balance can be withdrawn including the fee', async () => {
    const f = await fixture()
    const payment = (await f.create('withdraw', 'all', '10')).payload.payment
    assert.equal(payment.amount_nano, '9950000000')
    assert.equal(payment.total_nano, '10000000000')
    assert.equal((await f.balance()).available_nano, '0')
    assert.equal((await f.balance()).locked_nano, '10000000000')
    await settlePayment(payment.id, randomBytes(32).toString('hex'))
    assert.equal((await f.balance()).total_nano, '0')
    assert.equal((await f.balance()).locked_nano, '0')
  })
  await t.test('legacy withdrawals replay the original net input and retain their reserved total', async () => {
    const f = await fixture()
    const payment = (await f.create('withdraw', 'legacy', '0.15')).payload.payment
    // The old schema recorded a 0.1 transfer plus 0.05 fee without input metadata.
    await WalletTransaction.update({ meta: {} }, { where: { fk_user_id: f.user.pk_user_id } })
    assert.deepEqual((await f.create('withdraw', 'legacy', '0.1')).payload.payment, payment)
    await assert.rejects(f.create('withdraw', 'legacy', '0.15'), { code: 'IDEMPOTENCY_CONFLICT' })
    assert.equal((await f.balance()).locked_nano, '150000000')
    await settlePayment(payment.id, randomBytes(32).toString('hex'))
    assert.equal((await f.balance()).total_nano, '9850000000')
    assert.equal((await f.balance()).locked_nano, '0')
  })
  await t.test('concurrent withdrawals reserve the entered total and reject overdrafts', async () => {
    const f = await fixture()
    const results = await Promise.allSettled([f.create('withdraw', 'a', '8'), f.create('withdraw', 'b', '8')])
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1)
    assert.equal(results.find((r) => r.status === 'rejected').reason.code, 'INSUFFICIENT_BALANCE')
    const winner = results.find((r) => r.status === 'fulfilled').value.payload.payment
    const key = results[0].status === 'fulfilled' ? 'a' : 'b'
    assert.equal((await f.create('withdraw', key, '8')).payload.payment.id, winner.id)
    assert.equal((await f.balance()).available_nano, '2000000000')
    assert.equal((await f.balance()).locked_nano, '8000000000')
    assert.equal((await f.balance()).total_nano, '10000000000')
    await settlePayment(winner.id, randomBytes(32).toString('hex'))
    assert.equal((await f.balance()).total_nano, '2000000000')
    assert.equal((await f.balance()).locked_nano, '0')
  })
  await t.test('uncertain send retries the committed BOC, holds the queue and settles late receipts', async () => {
    const f = await fixture()
    const first = (await f.create('withdraw', 'retry')).payload.payment
    const second = (await f.create('withdraw', 'next')).payload.payment
    let prepared = 0
    const broadcasts = []
    const receipts = new Map()
    const gateway = {
      scanIncoming: async () => ({ transactions: [], head: null }),
      findReceipt: async (p) => receipts.get(String(p.pk_payment_id)) || null,
      prepareWithdrawal: async () => { prepared++; return { signed_boc: `signed-${prepared}`, valid_until: Math.floor(Date.now() / 1000) + 600 } },
      broadcast: async (p) => {
        assert.equal((await findPayment(p.pk_payment_id)).signed_boc, p.signed_boc, 'signed BOC must be committed before network send')
        broadcasts.push(p.signed_boc)
        throw new Error('Connection lost after send')
      },
    }
    await reconcilePayments({ config: f.config, gateway })
    await reconcilePayments({ config: f.config, gateway })
    assert.equal(prepared, 1)
    assert.deepEqual(broadcasts, ['signed-1', 'signed-1'])
    assert.equal((await findPayment(second.id)).status, 'queued')
    await TonPayment.update({ valid_until: 1 }, { where: { pk_payment_id: await paymentKey(first.id) } })
    await reconcilePayments({ config: f.config, gateway })
    assert.equal((await findPayment(first.id)).status, 'review')
    assert.equal((await f.balance()).locked_nano, '2000000000')
    receipts.set(String(await paymentKey(first.id)), randomBytes(32).toString('hex'))
    await reconcilePayments({ config: f.config, gateway })
    assert.equal((await findPayment(first.id)).status, 'completed')
    assert.equal((await findPayment(second.id)).status, 'broadcast')
    assert.equal((await f.balance()).locked_nano, '1000000000')
    assert.equal((await f.balance()).total_nano, '9000000000')
  })
  await t.test('queued payouts are signed and sent as one batch, limited to what the treasury covers', async () => {
    const f = await fixture()
    const config = { ...f.config, payoutBatchSize: 4 }
    const payments = []
    for (const key of ['batch-a', 'batch-b', 'batch-c']) payments.push((await f.create('withdraw', key)).payload.payment)
    const prepared = []
    const broadcasts = []
    const receipts = new Map()
    const gateway = {
      scanIncoming: async () => ({ transactions: [], head: null }),
      findReceipt: async p => receipts.get(String(p.pk_payment_id)) ?? null,
      // The treasury covers only the first two payouts of this batch.
      prepareWithdrawal: async batch => { prepared.push(batch.map(p => p.pk_payment_id)); return { signed_boc: `boc-${prepared.length}`, valid_until: Math.floor(Date.now() / 1000) + 600, seqno: 10 + prepared.length, count: Math.min(batch.length, 2) } },
      broadcast: async p => { broadcasts.push(p.signed_boc) },
      getSeqno: async () => 0,
    }
    await reconcilePayments({ config, gateway })
    const ids = await Promise.all(payments.map(p => paymentKey(p.id)))
    assert.deepEqual(prepared, [ids])
    assert.deepEqual(broadcasts, ['boc-1'])
    const rows = await Promise.all(payments.map(p => findPayment(p.id)))
    assert.deepEqual(rows.map(row => row.status), ['broadcast', 'broadcast', 'queued'])
    assert.deepEqual(rows.slice(0, 2).map(row => [row.signed_boc, String(row.seqno)]), [['boc-1', '11'], ['boc-1', '11']])
    // The in-flight batch is rebroadcast once and holds the queue.
    await reconcilePayments({ config, gateway })
    assert.deepEqual(broadcasts, ['boc-1', 'boc-1'])
    assert.equal(prepared.length, 1)
    for (const id of ids.slice(0, 2)) receipts.set(String(id), randomBytes(32).toString('hex'))
    await reconcilePayments({ config, gateway })
    assert.deepEqual((await Promise.all(payments.map(p => findPayment(p.id)))).map(row => row.status), ['completed', 'completed', 'broadcast'])
    assert.deepEqual(prepared.at(-1), [ids[2]])
  })
  await t.test('an expired payout is requeued if its seqno was never used, and review no longer blocks the queue', async () => {
    const f = await fixture()
    const first = (await f.create('withdraw', 'expire-unused')).payload.payment
    let seqno = 20
    let signed = 0
    const gateway = {
      scanIncoming: async () => ({ transactions: [], head: null }),
      findReceipt: async () => null,
      prepareWithdrawal: async () => ({ signed_boc: `boc-${++signed}`, valid_until: Math.floor(Date.now() / 1000) + 600, seqno, count: 1 }),
      broadcast: async () => {},
      getSeqno: async () => seqno,
    }
    const expire = async id => TonPayment.update({ valid_until: Math.floor(Date.now() / 1000) - 600 }, { where: { pk_payment_id: await paymentKey(id) } })
    await reconcilePayments({ config: f.config, gateway })
    await expire(first.id)
    // Wallet seqno unchanged: the expired BOC can never execute.
    await reconcilePayments({ config: f.config, gateway })
    let row = await findPayment(first.id)
    assert.equal(row.status, 'broadcast')
    assert.equal(row.signed_boc, 'boc-2', 'requeued payout is signed again in the same pass')
    assert.equal((await f.balance()).locked_nano, '1000000000')
    // Wallet seqno advanced without a receipt: ambiguous, so review. Next payouts still go.
    const second = (await f.create('withdraw', 'after-review')).payload.payment
    await expire(first.id)
    seqno = 21
    await reconcilePayments({ config: f.config, gateway })
    row = await findPayment(first.id)
    assert.equal(row.status, 'review')
    assert.equal((await findPayment(second.id)).status, 'broadcast')
    assert.equal(signed, 3)
  })
  await t.test('one treasury scan settles invoices, records unmatched transfers and resumes from its cursor', async () => {
    const f = await fixture()
    const blockchain = await Blockchain.create()
    const depositor = await blockchain.treasury('scan-depositor')
    const treasury = Address.parse(f.config.address)
    const invoice = (key, amount = '1') => createPayment({ currentUser: f.user, body: {
      amount, idempotency_key: key, wallet_address: depositor.address.toRawString(), network: '-3',
    } }, 'deposit', f.config).then(result => result.payload.payment)
    const send = async (value, memo) => {
      const result = await depositor.send({ to: treasury, value, bounce: false, ...(memo ? { body: commentCell(memo) } : {}) })
      return result.transactions.find(tx => tx.inMessage?.info.type === 'internal' && tx.inMessage.info.dest.equals(treasury))
    }
    const paid = await invoice('scan-paid')
    const expired = await invoice('scan-expired')
    const memoOf = async id => (await findPayment(id)).memo
    await TonPayment.update({ valid_until: 1 }, { where: { pk_payment_id: await paymentKey(expired.id) } })
    const wrongAmount = await send(2_000_000_000n, await memoOf(paid.id))
    const exact = await send(1_000_000_000n, await memoOf(paid.id))
    const unknown = await send(500_000_000n, 'not-an-invoice')
    const dust = await send(1_000n)
    const scans = []
    let batch = []
    const gateway = {
      scanIncoming: async (address, options) => { scans.push({ address, ...options }); return { transactions: batch, head: batch.at(-1) ?? null } },
      findReceipt: async () => null, prepareWithdrawal: async () => { throw new Error('unused') }, broadcast: async () => {},
    }
    // The first pass has no receipt for the expired invoice and expires it.
    await reconcilePayments({ config: f.config, gateway })
    assert.equal((await findPayment(expired.id)).status, 'expired')
    assert.equal(scans[0].afterLt, null)
    const late = await send(1_000_000_000n, await memoOf(expired.id))
    batch = [wrongAmount, exact, unknown, dust, late]
    await reconcilePayments({ config: f.config, gateway })
    await reconcilePayments({ config: f.config, gateway })
    assert.equal((await findPayment(paid.id)).status, 'completed')
    assert.equal((await findPayment(paid.id)).tx_hash, exact.hash().toString('hex'))
    assert.equal((await f.balance()).total_nano, '11000000000')
    const [rows] = await sequelize.query(`SELECT reason, amount_nano::text AS amount, tx_hash FROM ton_unmatched_deposits
      WHERE treasury_address = :address ORDER BY tx_lt`, { replacements: { address: f.config.address } })
    assert.deepEqual(rows.map(row => [row.reason, row.amount]), [
      ['payment_mismatch', '2000000000'], ['unknown_memo', '500000000'], ['payment_expired', '1000000000'],
    ])
    assert.equal(scans.at(-1).afterLt, late.lt.toString())
  })
  await t.test('a deposit above the balance limit is held for review and does not stop later deposits', async () => {
    const f = await fixture()
    const other = await fixture()
    const blockchain = await Blockchain.create()
    const depositor = await blockchain.treasury('limit-depositor')
    const treasury = Address.parse(f.config.address)
    const invoice = (user, key) => createPayment({ currentUser: user, body: {
      amount: '1', idempotency_key: key, wallet_address: depositor.address.toRawString(), network: '-3',
    } }, 'deposit', f.config).then(result => result.payload.payment)
    const send = async (id) => {
      const memo = (await findPayment(id)).memo
      const result = await depositor.send({ to: treasury, value: 1_000_000_000n, bounce: false, body: commentCell(memo) })
      return result.transactions.find(tx => tx.inMessage?.info.type === 'internal' && tx.inMessage.info.dest.equals(treasury))
    }
    const overLimit = await invoice(f.user, 'limit-over')
    const regular = await invoice(other.user, 'limit-regular')
    // The balance grew after the invoice was issued, so its payment no longer fits.
    const nearLimit = (BigInt(Number.MAX_SAFE_INTEGER) - 500_000_000n).toString()
    await WalletBalance.update({ available_nano: nearLimit }, { where: { fk_user_id: f.user.pk_user_id } })
    const batch = [await send(overLimit.id), await send(regular.id)]
    const gateway = {
      scanIncoming: async () => ({ transactions: batch, head: batch.at(-1) }),
      findReceipt: async () => null, prepareWithdrawal: async () => { throw new Error('unused') }, broadcast: async () => {},
    }
    await reconcilePayments({ config: f.config, gateway })
    await reconcilePayments({ config: f.config, gateway })
    assert.equal((await findPayment(overLimit.id)).status, 'pending')
    assert.equal((await f.balance()).total_nano, nearLimit)
    assert.equal((await findPayment(regular.id)).status, 'completed')
    assert.equal((await other.balance()).total_nano, '11000000000')
    const [rows] = await sequelize.query(`SELECT reason, amount_nano::text AS amount, fk_payment_id FROM ton_unmatched_deposits
      WHERE treasury_address = :address`, { replacements: { address: f.config.address } })
    assert.deepEqual(rows, [{ reason: 'balance_limit', amount: '1000000000', fk_payment_id: await paymentKey(overLimit.id) }])
    const [[cursor]] = await sequelize.query('SELECT last_lt::text AS lt FROM ton_scan_cursors WHERE network = :network AND address = :address',
      { replacements: { network: '-3', address: f.config.address } })
    assert.equal(cursor.lt, batch.at(-1).lt.toString())
  })
  await t.test('a failed treasury scan postpones invoice expiry', async () => {
    const f = await fixture()
    const invoice = (await f.create('deposit', 'scan-failed')).payload.payment
    await TonPayment.update({ valid_until: 1 }, { where: { pk_payment_id: await paymentKey(invoice.id) } })
    const gateway = { scanIncoming: async () => { throw new Error('RPC unavailable') }, findReceipt: async () => null }
    await reconcilePayments({ config: { ...f.config, mnemonic: '' }, gateway })
    assert.equal((await findPayment(invoice.id)).status, 'pending')
  })
  await t.test('missing configuration and wrong network never change balances', async () => {
    const f = await fixture()
    const context = { currentUser: f.user, body: { amount: '1', idempotency_key: 'x', wallet_address: userAddress, network: '-3' } }
    await assert.rejects(createPayment(context, 'deposit', { ...f.config, address: '' }), { statusCode: 503, code: 'TON_NOT_CONFIGURED' })
    await assert.rejects(createPayment(context, 'withdraw', { ...f.config, payoutsEnabled: false }), { statusCode: 503, code: 'TON_NOT_CONFIGURED' })
    await assert.rejects(createPayment({ ...context, body: { ...context.body, network: '-239' } }, 'deposit', f.config), { code: 'TON_NETWORK_MISMATCH' })
    assert.equal((await f.balance()).total_nano, '10000000000')
  })
})
