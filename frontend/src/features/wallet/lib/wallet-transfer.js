export function shortenTonAddress(address, headLength = 6, tailLength = 4) {
  const value = String(address ?? '').trim()
  if (!value) return ''
  if (value.length <= headLength + tailLength + 3) return value
  return `${value.slice(0, headLength)}...${value.slice(-tailLength)}`
}

/** A withdrawal's entered total includes its fee; the recipient gets the rest. */
export function getWithdrawalQuote(amountNano, feeNano, availableNano) {
  const totalNano = amountNano ?? 0n
  return {
    totalNano,
    receiveNano: totalNano > feeNano ? totalNano - feeNano : 0n,
    maxNano: availableNano,
    error: !amountNano ? null : totalNano <= feeNano ? 'AMOUNT_BELOW_FEE'
      : totalNano > availableNano ? 'INSUFFICIENT_BALANCE' : null,
  }
}
