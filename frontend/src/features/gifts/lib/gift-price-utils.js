import { parseGramAmount, formatGramAmount } from '../../../shared/lib/gram-amount.js'

export function normalizePriceInput(rawValue) {
  const filtered = String(rawValue ?? '')
  // Preserve invalid input so validation cannot turn it into a different price.
  if (!/^\d*(?:[.,]\d*)?$/.test(filtered)) return filtered
  const separatorIndex = filtered.search(/[.,]/)
  if (separatorIndex === -1) return filtered.replace(/^0+(?=\d)/, '')
  const integer = filtered.slice(0, separatorIndex).replace(/^0+(?=\d)/, '') || '0'
  const fraction = filtered.slice(separatorIndex + 1)
  return `${integer}${filtered[separatorIndex]}${fraction}`
}

export function isValidPricing({ minPrice, maxPrice, marketplaceFeeBps }) {
  return Number.isFinite(minPrice) && Number.isFinite(maxPrice) &&
    minPrice > 0 && maxPrice >= minPrice &&
    Number.isInteger(marketplaceFeeBps) && marketplaceFeeBps >= 0 && marketplaceFeeBps <= 10_000
}

export function getPriceDetails(rawAmount, pricing) {
  const minPrice = Number(pricing?.minPrice)
  const maxPrice = Number(pricing?.maxPrice)
  const feeBps = Number(pricing?.marketplaceFeeBps)
  const hasPricingRules = isValidPricing({ minPrice, maxPrice, marketplaceFeeBps: feeBps })
  const amountNano = parseGramAmount(rawAmount)
  const hasAmount = amountNano !== null
  const amount = Number(amountNano ?? 0n) / 1_000_000_000
  const isBelowMin = hasPricingRules && hasAmount && amount < minPrice
  const isAboveMax = hasPricingRules && hasAmount && amount > maxPrice
  const fee = hasPricingRules && hasAmount ? amount * feeBps / 10_000 : 0
  return {
    minPrice, maxPrice, hasPricingRules, isBelowMin, isAboveMax,
    isInvalid: !hasPricingRules || !hasAmount || isBelowMin || isAboveMax,
    formattedAmount: hasAmount ? formatGramAmount(amountNano) : '0',
    feeAmountLabel: String(Number(fee.toFixed(4))),
    sellerReceiveLabel: String(Number((hasAmount ? Math.max(amount - fee, 0) : 0).toFixed(4))),
    feePercentLabel: Number.isFinite(feeBps) ? String(Number((feeBps / 100).toFixed(2))) : '',
  }
}
