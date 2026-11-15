const NANO_PER_GRAM = 1_000_000_000n

/** Parse a user-entered GRAM amount with at most 9 decimals into positive nanos. */
export function parseGramAmount(value) {
  const normalized = String(value ?? '').trim().replace(',', '.')
  if (!/^(?:\d+(?:\.\d{0,9})?|\.\d{1,9})$/.test(normalized)) return null
  const [whole, fraction = ''] = normalized.split('.')
  const nano = BigInt(whole || '0') * NANO_PER_GRAM + BigInt(fraction.padEnd(9, '0'))
  return nano > 0n && nano <= BigInt(Number.MAX_SAFE_INTEGER) ? nano : null
}

/** Exact decimal GRAM text for a nano amount, without trailing zeros. */
export function formatGramAmount(nano) {
  const amount = BigInt(nano)
  const fraction = (amount % NANO_PER_GRAM).toString().padStart(9, '0').replace(/0+$/, '')
  return `${amount / NANO_PER_GRAM}${fraction ? `.${fraction}` : ''}`
}
