import { request } from '../../../shared/api/client.js'

/** Buys the exact listing and price in `purchase` (see purchasePayload). */
export async function buyGift(purchase, options) {
  const send = async () => {
    const response = await request('/gifts/buy', { ...options, method: 'POST', body: purchase })
    // Headers can arrive before the connection drops while reading the body.
    if (response.ok && response.data?.ok !== true) throw new Error('Purchase response is incomplete')
    return response
  }
  try {
    return await send()
  } catch (error) {
    // A lost response may follow a committed purchase; the server answers a repeat
    // of the same listing and price with the original success.
    if (options?.signal?.aborted || error.name === 'AbortError') throw error
    return send()
  }
}

export function getGiftQuote(giftId, options) {
  return request(`/gifts/${giftId}/quote`, options)
}

export function listGift(giftId, price, options) {
  return request('/gifts/list', { ...options, method: 'POST', body: { id: giftId, price } })
}

export function cancelGiftListing(giftId, options) {
  return request('/gifts/cancel', { ...options, method: 'POST', body: { id: giftId } })
}

export function withdrawGift(withdrawal, options) {
  return request('/gifts/withdraw', { ...options, method: 'POST', body: withdrawal })
}

export function getGiftWithdrawal(jobId, options) {
  return request(`/gifts/withdrawals/${jobId}`, options)
}

export function getMarketConfig(options) {
  return request('/market/config', options)
}
