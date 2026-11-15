import { request } from '../../../shared/api/client.js'
import { toQueryString } from '../../../shared/api/query.js'

export function createOffer(giftId, amount, options) {
  return request('/offers', { ...options, method: 'POST', body: { gift_id: giftId, amount } })
}

export function getOffers({ cursor, ...options } = {}) {
  return request(`/my/offers?${toQueryString({ role: 'all', status: 'all', limit: 20, cursor })}`, options)
}

// Refresh through the oldest visible offer, including new entries that shift
// previously loaded cards onto later pages. Publish only a complete snapshot.
export async function refreshOffers({ oldestId, ...options }) {
  const offers = []
  let cursor = null
  let pendingCount
  while (true) {
    const response = await getOffers({ ...options, cursor })
    if (!response.ok || !Array.isArray(response.data?.offers)) throw new Error('Offers unavailable')
    if (cursor === null) pendingCount = response.data.pending_incoming_count
    offers.push(...response.data.offers)
    const nextCursor = response.data.pagination?.next_cursor ?? null
    if (!oldestId || !nextCursor || response.data.offers.some(offer => offer.id === oldestId)) {
      return { offers, pendingCount, nextCursor }
    }
    if (cursor !== null && nextCursor === cursor) throw new Error('Invalid offers cursor')
    cursor = nextCursor
  }
}

/** action: 'accept' | 'reject' | 'cancel' */
export function resolveOffer(offerId, action, options) {
  return request(`/offers/${offerId}/${action}`, { ...options, method: 'POST' })
}
