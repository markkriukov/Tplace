export function isWalletPayload(wallet) {
  return wallet != null && /^\d+$/.test(String(wallet.available_nano ?? '')) &&
    BigInt(wallet.available_nano) <= BigInt(Number.MAX_SAFE_INTEGER) &&
    (wallet.locked_nano == null || /^\d+$/.test(String(wallet.locked_nano))) &&
    (wallet.currency_code == null || typeof wallet.currency_code === 'string')
}
