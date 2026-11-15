import { toIsoString } from '../../http/serialize.js'
import { mapGiftSummary } from '../gifts/gifts.mapper.js'

export function mapOfferPayload(offer) {
  return {
    id: offer.public_id,
    gift_id: offer.Gift?.public_id ?? null,
    amount_nano: String(offer.amount_nano),
    status: offer.status ?? 'pending',
    created_at: toIsoString(offer.created_at),
    expires_at: toIsoString(offer.expires_at),
    gift: mapGiftSummary(offer.Gift),
  }
}
