import { listOffers, createOffer, acceptOffer, rejectOffer, cancelOffer } from './offers.service.js'

export const routeOffers = [
  { method: 'GET', path: '/my/offers', handler: listOffers, auth: 'required', query: 'offers' },
  { method: 'POST', path: '/offers', handler: createOffer, auth: 'required', body: 'offerCreate' },
  { method: 'POST', path: '/offers/{id}/accept', handler: acceptOffer, auth: 'required', body: 'empty' },
  { method: 'POST', path: '/offers/{id}/reject', handler: rejectOffer, auth: 'required', body: 'empty' },
  { method: 'POST', path: '/offers/{id}/cancel', handler: cancelOffer, auth: 'required', body: 'empty' },
]
