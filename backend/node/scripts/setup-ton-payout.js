import { createInterface } from 'node:readline/promises'
import { Writable } from 'node:stream'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseEnv } from 'node:util'
import { getTonConfig, friendlyAddress } from '../src/modules/wallet/ton/ton.config.js'
import { deriveTreasurySigner } from '../src/modules/wallet/ton/ton.signer.js'
import { createTonRpcClient } from '../src/modules/wallet/ton/ton.rpc.js'

const envPath = fileURLToPath(new URL('../../../.env', import.meta.url))
const runtime = fileURLToPath(new URL('../runtime/', import.meta.url))
const secretPath = fileURLToPath(new URL('../runtime/ton-payout-mnemonic.secret', import.meta.url))
const statusPath = fileURLToPath(new URL('../runtime/ton-payout-setup.json', import.meta.url))
const status = (value) => {
  mkdirSync(runtime, { recursive: true, mode: 0o700 })
  writeFileSync(statusPath, JSON.stringify({ ...value, updated_at: new Date().toISOString() }, null, 2), { mode: 0o600 })
}

function updateEnv(changes) {
  const lines = readFileSync(envPath, 'utf8').split(/\r?\n/)
  const seen = new Set()
  const updated = lines.flatMap((line) => {
    const key = line.split('=', 1)[0].trim()
    if (!(key in changes)) return [line]
    if (seen.has(key)) return []
    seen.add(key)
    return [`${key}=${changes[key]}`]
  })
  for (const [key, value] of Object.entries(changes)) if (!seen.has(key)) updated.push(`${key}=${value}`)
  writeFileSync(envPath, updated.join('\n').trimEnd() + '\n')
}

async function readHiddenSeed() {
  if (!process.stdin.isTTY) throw new Error('INTERACTIVE_TERMINAL_REQUIRED')
  // Readline owns the terminal in raw mode; its echo goes to this sink.
  const output = new Writable({ write(_chunk, _encoding, done) { done() } })
  const reader = createInterface({ input: process.stdin, output, terminal: true, historySize: 0 })
  const controller = new AbortController()
  reader.once('SIGINT', () => controller.abort())
  process.stdout.write('Paste 12 or 24 words in ONE LINE (input is hidden), then press Enter: ')
  try { return await reader.question('', { signal: controller.signal }) }
  finally { reader.close(); process.stdout.write('\n') }
}

async function main() {
  const env = parseEnv(readFileSync(envPath, 'utf8'))
  const config = getTonConfig({ ...process.env, ...env, TON_TREASURY_MNEMONIC: '', TON_TREASURY_MNEMONIC_FILE: '' })
  if (!config.address) throw new Error('TREASURY_ADDRESS_REQUIRED')
  console.log(`Payout wallet: ${friendlyAddress(config.address, config.network)} (${config.network === '-239' ? 'mainnet' : 'testnet'})`)
  console.log('The seed stays in a local ignored file. No transaction will be sent by this setup tool.')
  const checking = process.argv.includes('--check')
  status({ status: checking ? 'checking' : 'awaiting_local_input' })
  let mnemonic = checking ? readFileSync(secretPath, 'utf8') : await readHiddenSeed()
  mnemonic = mnemonic.trim().toLowerCase().split(/\s+/).join(' ')
  const signer = await deriveTreasurySigner({ ...config, mnemonic })
  signer.keys.secretKey.fill(0) // Only the public contract is needed for readiness checks.
  if (existsSync(secretPath)) {
    if (readFileSync(secretPath, 'utf8').trim() !== mnemonic) throw new Error('EXISTING_SECRET_DIFFERS')
  } else writeFileSync(secretPath, mnemonic + '\n', { mode: 0o600, flag: 'wx' })
  // Drop this reference before doing RPC I/O; never include it in diagnostics.
  // eslint-disable-next-line no-useless-assignment
  mnemonic = ''
  updateEnv({ TON_TREASURY_MNEMONIC: '', TON_TREASURY_MNEMONIC_FILE: 'runtime/ton-payout-mnemonic.secret', TON_PAYOUTS_ENABLED: 'false' })
  console.log(`Key verified for ${signer.version} (${signer.scheme}) and saved locally. Checking the wallet in the blockchain...`)
  const client = createTonRpcClient(config)
  const account = await client.getContractState(signer.contract.address)
  if (account.state !== 'active') {
    status({ status: 'awaiting_activation', version: signer.version, key_saved: true })
    console.log('The key is saved, but the wallet is not active yet. Activate it in your wallet app, then run: npm run wallet:payouts:check')
    return
  }
  const wallet = client.open(signer.contract)
  const seqno = await wallet.getSeqno()
  if (seqno === 0) {
    status({ status: 'awaiting_activation', version: signer.version, key_saved: true })
    console.log('The key is saved. Complete wallet initialization (seqno > 0) in your wallet app, then run: npm run wallet:payouts:check')
    return
  }
  if (signer.version === 'V5R1') {
    if (!await wallet.getIsSecretKeyAuthEnabled()) throw new Error('WALLET_SIGNATURES_DISABLED')
  }
  if (account.balance < 50_000_000n) {
    status({ status: 'awaiting_funds', version: signer.version, key_saved: true })
    console.log('The key is saved. Fund the wallet for payouts and network fees, then run: npm run wallet:payouts:check')
    return
  }
  updateEnv({ TON_PAYOUTS_ENABLED: 'true' })
  status({ status: 'ready', version: signer.version, key_saved: true })
  console.log('Payout key is ready. Apply settings from the project root: docker compose up -d --no-deps backend-node')
}

main().catch((error) => {
  const messages = {
    INVALID_MNEMONIC: 'Invalid seed. Enter 12 BIP39 words or 24 TON/BIP39 words in one line. The seed was not saved or sent.',
    TREASURY_ADDRESS_MISMATCH: 'This seed does not match the configured address as a standard V4R2 or V5R1 wallet. The existing address was preserved.',
    INTERACTIVE_TERMINAL_REQUIRED: 'Run this tool in a local interactive terminal.',
    TREASURY_ADDRESS_REQUIRED: 'Set TON_TREASURY_ADDRESS in the root .env first.',
    EXISTING_SECRET_DIFFERS: 'A different secret already exists locally. It was not overwritten.',
    WALLET_SIGNATURES_DISABLED: 'This V5R1 wallet has disabled signing with its secret key.',
  }
  const code = error.name === 'AbortError' ? 'CANCELED' : Object.hasOwn(messages, error.message) ? error.message : 'SETUP_CHECK_FAILED'
  status({ status: 'error', code })
  console.error(messages[code] || (code === 'CANCELED' ? 'Canceled.' : 'Could not complete setup. Check RPC availability and retry with --check if the key was already saved.'))
  // Never print the original error: RPC error objects can include request data.
  process.exitCode = 1
})
