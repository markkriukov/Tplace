import { createHttpError } from '../../http/errors.js'

// All money arithmetic uses BigInt nano amounts. Values cross into the database
// and JSON as decimal strings (see nanoString/jsonSafe); Number never carries money.

/** @param {string | number | bigint} value */
export function formatNanoAmount(value) {
  const nano = BigInt(value)
  const sign = nano < 0n ? '-' : ''
  const absolute = nano < 0n ? -nano : nano
  const fraction = (absolute % 1_000_000_000n).toString().padStart(9, '0').replace(/0+$/, '')
  return `${sign}${absolute / 1_000_000_000n}${fraction ? `.${fraction}` : ''}`
}

// The public product limit remains MAX_SAFE_INTEGER nanos, so every balance
// also stays exact for clients that parse amounts as JavaScript numbers.
export const MAX_NANO = BigInt(Number.MAX_SAFE_INTEGER)

/** A checked, non-negative nano amount.
 * @param {string | number | bigint} value @returns {bigint} */
export function toNano(value) {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) throw new RangeError('Inexact nano amount')
  if (typeof value === 'string' && !/^-?\d+$/.test(value)) throw new RangeError('Malformed nano amount')
  const nano = BigInt(value)
  if (nano < 0n) throw new RangeError('Negative nano amount')
  if (nano > MAX_NANO) throw createHttpError(409, 'Balance exceeds the supported limit', 'BALANCE_LIMIT')
  return nano
}
/** @param {string | number | bigint} a @param {string | number | bigint} b */
export function addNano(a, b) {
  return toNano(toNano(a) + toNano(b))
}
/** @param {string | number | bigint} a @param {string | number | bigint} b */
export function subtractNano(a, b) {
  return toNano(toNano(a) - toNano(b))
}
/** @param {string | number | bigint} amount @param {number} bps */
export function feeNano(amount, bps) {
  return toNano(toNano(amount) * BigInt(bps) / 10000n)
}
/** @param {string | number | bigint} value */
export function nanoString(value) {
  return toNano(value).toString()
}

/** Copy a ledger meta object with BigInt values as strings, for JSON columns.
 * @param {unknown} value @returns {any} */
export function jsonSafe(value) {
  if (typeof value === 'bigint') return value.toString()
  if (Array.isArray(value)) return value.map(jsonSafe)
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonSafe(item)]))
  }
  return value
}

/** Parse a user-entered GRAM amount with at most 9 decimals. Zero is accepted
 * only with allowZero (price filters); amounts that move money must be positive.
 * @param {unknown} rawAmount @param {{allowZero?: boolean}} [options] @returns {bigint | null} */
export function parseAmountToNano(rawAmount, { allowZero = false } = {}) {
  const normalized = typeof rawAmount === 'number' && Number.isFinite(rawAmount)
    ? rawAmount.toFixed(9) : String(rawAmount ?? '').trim().replace(',', '.')
  if (!/^(?:\d+\.?\d{0,9}|\.\d{1,9})$/.test(normalized)) return null
  if (typeof rawAmount === 'number' && Number(normalized) !== rawAmount) return null
  const [whole, fraction = ''] = normalized.split('.')
  const amount = BigInt(whole || '0') * 1_000_000_000n + BigInt(fraction.padEnd(9, '0'))
  if (amount < 0n || (amount === 0n && !allowZero) || amount > MAX_NANO) return null
  return amount
}

// Read a locked wallet row as checked integers. NULL means the ledger is
// corrupt: fail the trade instead of substituting zero. The total is not stored;
// it must itself stay within the supported range.
/** @param {{available_nano: unknown, locked_nano: unknown}} wallet */
export function walletNano(wallet) {
  if (wallet.available_nano == null || wallet.locked_nano == null) {
    throw new Error('Wallet balance is incomplete')
  }
  const available = toNano(/** @type {string | number} */ (wallet.available_nano))
  const locked = toNano(/** @type {string | number} */ (wallet.locked_nano))
  return { available, locked, total: addNano(available, locked) }
}

/** Write balances to a wallet row; the total follows from them.
 * @param {{available_nano: unknown, locked_nano: unknown, updated_at?: unknown}} wallet
 * @param {{available: bigint, locked: bigint}} balances */
export function setWalletNano(wallet, { available, locked }) {
  addNano(available, locked)
  wallet.available_nano = nanoString(available)
  wallet.locked_nano = nanoString(locked)
  wallet.updated_at = new Date()
}
