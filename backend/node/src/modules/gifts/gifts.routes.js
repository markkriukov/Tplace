import { getQuote } from './listings/listings-quote.service.js'
import { getGiftWithdrawal } from './withdrawals/withdrawals.service.js'
import { createGiftImport, getGiftImport } from './imports/imports.service.js'
import { getInventory, listGift, buyGift, cancelListing, withdrawGift } from './gifts.service.js'

export const routeGifts = [
  { method: 'POST', path: '/gifts/withdraw', handler: withdrawGift, auth: 'required', body: 'giftWithdraw' },
  { method: 'GET', path: '/gifts/withdrawals/{id}', handler: getGiftWithdrawal, auth: 'required' },
  { method: 'GET', path: '/gifts/{id}/quote', handler: getQuote, auth: 'none' },
  { method: 'GET', path: '/my/inventory', handler: getInventory, auth: 'required', query: 'inventory' },
  { method: 'POST', path: '/gifts/list', handler: listGift, auth: 'required', body: 'giftList' },
  { method: 'POST', path: '/gifts/buy', handler: buyGift, auth: 'required', body: 'giftBuy' },
  { method: 'POST', path: '/gifts/cancel', handler: cancelListing, auth: 'required', body: 'giftCancel' },
  { method: 'POST', path: '/admin/gift-imports', handler: createGiftImport, auth: 'admin', body: 'giftImport' },
  { method: 'GET', path: '/admin/gift-imports', handler: getGiftImport, auth: 'admin' },
]
