import { Address } from '@ton/core'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export function getTonConfig(env = process.env) {
  const network = env.TON_NETWORK || '-239'
  if (!['-239', '-3'].includes(network)) throw new Error('Invalid TON_NETWORK')
  const address = env.TON_TREASURY_ADDRESS?.trim() || ''
  const fee = env.TON_WITHDRAW_FEE_NANO || '50000000'
  if (!/^\d+$/.test(fee) || BigInt(fee) > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('Invalid TON_WITHDRAW_FEE_NANO')
  }
  const batch = env.TON_PAYOUT_BATCH_SIZE?.trim() || '4'
  if (!/^[1-4]$/.test(batch)) throw new Error('TON_PAYOUT_BATCH_SIZE must be an integer between 1 and 4')
  const secretFile = env.TON_TREASURY_MNEMONIC_FILE?.trim()
  const mnemonic = secretFile
    ? readFileSync(resolve(fileURLToPath(new URL('../../../../', import.meta.url)), secretFile), 'utf8').trim()
    : env.TON_TREASURY_MNEMONIC?.trim() || ''
  return {
    network,
    address: address ? normalizeAddress(address, network) : '',
    endpoint: env.TON_RPC_URL || (network === '-3'
      ? 'https://testnet.toncenter.com/api/v2/jsonRPC'
      : 'https://toncenter.com/api/v2/jsonRPC'),
    apiKey: env.TON_RPC_API_KEY || undefined,
    mnemonic,
    payoutsEnabled: env.TON_PAYOUTS_ENABLED !== 'false',
    feeNano: fee,
    payoutBatchSize: Number(batch),
  }
}

/** @param {unknown} value @param {string} network */
export function normalizeAddress(value, network) {
  if (typeof value !== 'string') throw new Error('Invalid address')
  if (Address.isFriendly(value) && Address.parseFriendly(value).isTestOnly && network !== '-3') {
    throw new Error('Testnet address on mainnet')
  }
  const address = Address.parse(value)
  if (address.workChain !== 0) throw new Error('Only basechain wallets are supported')
  return address.toRawString()
}

/** @param {string} address @param {string} network */
export function friendlyAddress(address, network) {
  return Address.parse(address).toString({ bounceable: false, testOnly: network === '-3' })
}
