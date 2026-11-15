import { getWallet, getWalletBalance, listTransactions, deposit, withdraw } from './wallet.service.js'
import { getPayment } from './payments/payments.service.js'

export const routeWallet = [
  { method: 'GET', path: '/my/wallet', handler: getWallet, auth: 'required' },
  { method: 'GET', path: '/my/wallet/balance', handler: getWalletBalance, auth: 'required' },
  { method: 'GET', path: '/my/wallet/transactions', handler: listTransactions, auth: 'required', query: 'walletHistory' },
  { method: 'GET', path: '/my/wallet/payments/{id}', handler: getPayment, auth: 'required' },
  { method: 'POST', path: '/my/wallet/deposit', handler: deposit, auth: 'required', body: 'walletChange' },
  { method: 'POST', path: '/my/wallet/withdraw', handler: withdraw, auth: 'required', body: 'walletChange' },
]
