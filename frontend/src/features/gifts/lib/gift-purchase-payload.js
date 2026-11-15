// Preserve the exact quote displayed to the buyer; never reconstruct it from a rounded price.
export function purchasePayload(gift) {
  if (!gift.listing_id || !gift.price_nano) {
    throw Object.assign(new Error('Refresh the listing before buying'), { code: 'LISTING_CHANGED' })
  }
  // A listing sells once, so the server recognizes a repeat of this exact request.
  return { id: gift.id, listing_id: gift.listing_id, expected_price_nano: gift.price_nano }
}
