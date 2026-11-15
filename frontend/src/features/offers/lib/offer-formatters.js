import { DEFAULT_PLACEHOLDER_IMAGE } from '../../../shared/config/placeholder-images.js'
import { getDateFormatters } from '../../../shared/lib/date-formatters.js'
import { formatGramAmount } from '../../../shared/lib/gram-amount.js'
import { resolveGiftImage } from '../../gifts/lib/gift-utils.js'

/** Offers for the profile list, with their status and deadline. */
export function formatProfileOfferItems(offers, t, language = 'en') {
  const formatter = getDateFormatters(language).short
  return offers.map((offer) => {
    const direction = offer.direction === 'outgoing' ? 'outgoing' : 'incoming'
    const status = String(offer.status ?? '').toLowerCase() || 'pending'
    const createdAt = offer.created_at ? new Date(offer.created_at) : null
    const giftNumber = String(offer.gift?.number ?? '').trim()
    return {
      id: String(offer.id ?? ''),
      title: offer.gift?.title || t('common.gift'),
      numberLabel: `#${giftNumber || String(offer.gift_id ?? '')}`,
      price: formatGramAmount(offer.amount_nano ?? 0),
      image: resolveGiftImage(offer.gift, DEFAULT_PLACEHOLDER_IMAGE),
      direction,
      directionLabel: t(direction === 'incoming' ? 'offer.incoming' : 'offer.outgoing'),
      status,
      statusText: t(`offer.status.${status}`),
      createdAtLabel: createdAt && Number.isFinite(createdAt.getTime())
        ? formatter.format(createdAt).replace(',', '')
        : t('time.unknown'),
      expiresAtMs: offer.expires_at ? new Date(offer.expires_at).getTime() : null,
    }
  })
}

/** Time left before a pending offer expires, as HH:MM:SS. */
export function formatOfferTimeLeft(offer, nowMs, t) {
  if (offer.status !== 'pending') return offer.statusText || t('profile.finished')
  const expiresAtMs = Number(offer.expiresAtMs)
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= 0) return '--:--:--'
  const totalSeconds = Math.max(0, Math.floor((expiresAtMs - nowMs) / 1000))
  return [Math.floor(totalSeconds / 3600), Math.floor((totalSeconds % 3600) / 60), totalSeconds % 60]
    .map((part) => String(part).padStart(2, '0')).join(':')
}
