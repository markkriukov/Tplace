import { isWalletPayload } from '../../src/features/wallet/lib/wallet-payload.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { parseGramAmount, formatGramAmount } from '../../src/shared/lib/gram-amount.js'
import { getWithdrawalQuote } from '../../src/features/wallet/lib/wallet-transfer.js'
import { formatWalletActions, formatProfileHistoryItems } from '../../src/features/wallet/lib/wallet-formatters.js'
import { translations } from '../../src/shared/i18n/translations.js'
import { createManifest, tonConnectManifestPlugin } from '../../scripts/tonconnect-manifest.mjs'
import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'

const t = (key) => translations.en[key] ?? key

test('GRAM input preserves nanos and rejects partial or imprecise amounts', () => {
  assert.equal(parseGramAmount('0,000000001'), 1n)
  assert.equal(parseGramAmount('9007199.254740991'), 9007199254740991n)
  assert.equal(formatGramAmount(1000000001n), '1.000000001')
  assert.equal(formatGramAmount(0n), '0')
  for (const value of ['0', '-1', '1e3', '10abc', '1.0000000001', 'Infinity', '9007199.254740992']) {
    assert.equal(parseGramAmount(value), null)
  }
})

test('withdrawal form includes the fee in the entered amount and Max uses the full balance', () => {
  const fee = 50000000n
  const available = 100000000n
  const quote = getWithdrawalQuote(parseGramAmount('0,1'), fee, available)
  assert.deepEqual(quote, { totalNano: available, receiveNano: 50000000n, maxNano: available, error: null })
  assert.equal(getWithdrawalQuote(parseGramAmount('0.05'), fee, available).error, 'AMOUNT_BELOW_FEE')
  assert.equal(getWithdrawalQuote(parseGramAmount('0.049999999'), fee, available).receiveNano, 0n)
  assert.equal(getWithdrawalQuote(parseGramAmount('0.050000001'), fee, available).receiveNano, 1n)
  assert.equal(getWithdrawalQuote(parseGramAmount('0.100000001'), fee, available).error, 'INSUFFICIENT_BALANCE')
  assert.equal(getWithdrawalQuote(available, 0n, available).receiveNano, available)
  const transactions = [{ tx_kind: 'withdraw', direction: 'debit', status: 'completed',
    amount_nano: '50000000', fee_nano: '50000000' }]
  const [entry] = formatWalletActions(transactions, 'GRAM', t)
  assert.equal(entry.amount, '-0.1 GRAM')
  assert.equal(formatProfileHistoryItems(transactions, t)[0].price, '0.1')
})

test('recent wallet actions include deposits, withdrawals and gift fees while profile history stays complete', () => {
  const kinds = ['deposit', 'purchase', 'sale', 'offer_escrow_lock', 'withdraw', 'offer_escrow_release', 'marketplace_fee', 'gift_withdrawal_fee']
  const transactions = kinds.map((tx_kind, index) => ({ id: index + 1, tx_kind, amount_nano: '1000000000' }))
  assert.deepEqual(formatWalletActions(transactions, 'GRAM', t).map(item => item.id), ['1', '5', '8'])
  assert.equal(formatProfileHistoryItems(transactions, t).length, transactions.length)
})

test('gift fee history shows the charge and no debit for a refunded reservation', () => {
  const transactions = ['pending', 'completed', 'canceled'].map((status, index) => ({
    id: index + 1, tx_kind: 'gift_withdrawal_fee', direction: 'debit', status,
    amount_nano: '250000000', fee_nano: '0',
  }))
  const actions = formatWalletActions(transactions, 'GRAM', t)
  assert.deepEqual(actions.map(item => item.amount), ['-0.25 GRAM', '-0.25 GRAM', '-0 GRAM'])
  assert.match(actions[0].type, /Pending/)
  assert.match(actions[2].type, /Canceled/)
  assert.deepEqual(formatProfileHistoryItems(transactions, t).map(item => item.price), ['0.25', '0.25', '0'])
})

test('manifest uses the public HTTPS origin for app and icon', () => {
  assert.deepEqual(createManifest('https://market.example/'), {
    name: 'TPlace', url: 'https://market.example', iconUrl: 'https://market.example/tonconnect-icon.png',
  })
  assert.throws(() => createManifest('javascript:alert(1)'))
  for (const origin of ['http://market.example', 'https://localhost:5173', 'https://127.0.0.1', 'https://[::1]']) {
    assert.throws(() => createManifest(origin), /public HTTPS/)
  }
})

test('manifest keeps the public origin behind a proxy and permits uncached wallet requests', () => {
  const plugin = tonConnectManifestPlugin('https://dev.tplace.store')
  let handleRequest
  assert.equal(plugin.configureServer({ middlewares: { use(handler) { handleRequest = handler } } }), undefined)
  const headers = {}
  let body
  const response = { setHeader: (key, value) => { headers[key] = value }, end: (value) => { body = value } }
  handleRequest({ method: 'GET', url: '/tonconnect-manifest.json?v=2', headers: { host: 'frontend:5173' } }, response, () => assert.fail('Manifest fell through to the static file'))
  assert.deepEqual(JSON.parse(body), {
    url: 'https://dev.tplace.store', name: 'TPlace', iconUrl: 'https://dev.tplace.store/tonconnect-icon.png',
  })
  assert.equal(headers['Access-Control-Allow-Origin'], '*')
  assert.equal(headers['Cache-Control'], 'no-store')
  handleRequest({ method: 'OPTIONS', url: '/tonconnect-manifest.json' }, response, () => assert.fail())
  assert.equal(response.statusCode, 204)
  handleRequest({ method: 'GET', url: '/tonconnect-icon.png' }, response, () => {})
  assert.equal(headers['Access-Control-Allow-Origin'], '*')
})

test('Vite reads the shared env directory and preserves environment overrides and the public manifest fallback', async () => {
  const { createViteConfig } = await import('../../vite.config.js')
  const directory = mkdtempSync(path.join(tmpdir(), 'tplace-vite-test-'))
  const previousTarget = process.env.VITE_API_PROXY_TARGET
  try {
    writeFileSync(path.join(directory, '.env'), 'VITE_API_PROXY_TARGET=http://127.0.0.1:4999\n')
    delete process.env.VITE_API_PROXY_TARGET
    const config = createViteConfig({ mode: 'development' }, directory)
    assert.equal(config.envDir, directory)
    assert.equal(config.envPrefix, 'VITE_')
    assert.equal(config.server.proxy['/api'].target, 'http://127.0.0.1:4999')
    assert.equal(createViteConfig({ mode: 'development' }).envDir, path.resolve(import.meta.dirname, '../../..') + path.sep)
    process.env.VITE_API_PROXY_TARGET = 'http://127.0.0.1:4888'
    assert.equal(createViteConfig({ mode: 'development' }, directory).server.proxy['/api'].target, 'http://127.0.0.1:4888')
  } finally {
    if (previousTarget === undefined) delete process.env.VITE_API_PROXY_TARGET
    else process.env.VITE_API_PROXY_TARGET = previousTarget
    unlinkSync(path.join(directory, '.env'))
    rmdirSync(directory)
  }
  const plugin = tonConnectManifestPlugin()
  let emitted
  plugin.generateBundle.call({ emitFile: (file) => { emitted = file } })
  assert.equal(emitted.fileName, 'tonconnect-manifest.json')
  const manifest = JSON.parse(emitted.source)
  assert.equal(manifest.url, 'https://dev.tplace.store')
  assert.equal(manifest.iconUrl, 'https://dev.tplace.store/tonconnect-icon.png')
  let handler
  plugin.configurePreviewServer({ middlewares: { use: (value) => { handler = value } } })
  assert.equal(typeof handler, 'function')
})

test('wallet payload rejects incomplete, negative, fractional and overflowing balances', () => {
  for (const wallet of [{}, { available_nano: null }, { available_nano: '-1' },
    { available_nano: '1.5' }, { available_nano: '9007199254740992' }]) {
    assert.equal(isWalletPayload(wallet), false)
  }
  assert.equal(isWalletPayload({ available_nano: '0' }), true)
  assert.equal(isWalletPayload({ available_nano: '9007199254740991' }), true)
})

test('history retains nano precision and translates failed transactions', () => {
  const rows = [{ id: 1, tx_kind: 'deposit', direction: 'credit', status: 'failed', amount_nano: '1' },
    { id: 2, tx_kind: 'withdraw', direction: 'debit', amount_nano: '1000000001', fee_nano: '1' }]
  assert.equal(formatWalletActions(rows, 'GRAM', t)[0].amount, '+0.000000001 GRAM')
  assert.equal(formatWalletActions(rows, 'GRAM', t)[1].amount, '-1.000000002 GRAM')
  const history = formatProfileHistoryItems(rows, key => `translated:${key}`)
  assert.equal(history[0].type, 'translated:wallet.historyFailed')
  assert.equal(history[0].price, '0.000000001')
})
