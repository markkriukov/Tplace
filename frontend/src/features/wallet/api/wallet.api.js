import { request } from '../../../shared/api/client.js'
import { toQueryString } from '../../../shared/api/query.js'

export function getWallet(options) {
  return request('/my/wallet', options)
}

export function getWalletBalance(options) {
  return request('/my/wallet/balance', options)
}

export function getWalletTransactions({ cursor, ...options }) {
  return request(`/my/wallet/transactions?${toQueryString({ limit: 25, cursor })}`, options)
}

/** kind: 'deposit' | 'withdraw' */
export function createPayment(kind, payment, options) {
  return request(`/my/wallet/${kind}`, { ...options, method: 'POST', body: payment })
}

export function getPayment(id, options) {
  return request(`/my/wallet/payments/${encodeURIComponent(id)}`, options)
}
