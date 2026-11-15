import { formatGramAmount } from '../../../shared/lib/gram-amount.js'
import { DEFAULT_PLACEHOLDER_IMAGE } from '../../../shared/config/placeholder-images.js'

const FRAGMENT_GIFT_URL = 'https://nft.fragment.com/gift'

export function trimText(value) {
  return String(value ?? '').trim()
}

export function normalizeFilterValue(value) {
  return trimText(value).toLowerCase()
}

export function isHiddenCollection(shortName, displayName) {
  return normalizeFilterValue(shortName) === 'telegramgifts' || normalizeFilterValue(displayName) === 'telegram gifts'
}

export function parseCatalogRarity(value) {
  const text = trimText(value).replace(',', '.')
  if (!text) return null
  if (!/^\d+(?:\.\d+)?$/.test(text)) return text
  const parsed = Number(text)
  return Number.isFinite(parsed) ? parsed : null
}

/** Catalog rarities are parts per thousand; the UI shows a percentage. */
export function formatRarityValue(value) {
  if (value == null) return null
  if (typeof value === 'number' && !Number.isFinite(value)) return null
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return trimText(value) || null
  const percent = numeric / 10
  return `${percent.toFixed(Number.isInteger(percent) ? 0 : 1)}%`
}

export function getRarityLabel(groupKey, gift) {
  const rawText = trimText(gift?.attributes?.[groupKey]?.rarity)
  if (!rawText) return null
  return formatRarityValue(parseCatalogRarity(rawText)) ?? rawText
}

const giftNumber = (gift) => String(gift?.number ?? '').replace(/\D/g, '')
const collectionSlug = (gift) => trimText(gift?.title).replace(/[^A-Za-z0-9]/g, '')

/** Fragment's NFT path, such as "plushpepe-12", from a gift's collection title and number. */
function fragmentPath(gift) {
  const slug = collectionSlug(gift).toLowerCase()
  const number = giftNumber(gift)
  return slug && number ? `${slug}-${number}` : ''
}

export function buildTelegramNftUrl(gift) {
  const slug = collectionSlug(gift)
  const number = giftNumber(gift)
  return slug && number ? `https://t.me/nft/${slug}-${number}` : ''
}

/** Fragment artwork of a gift summary, else its own image, else the fallback. */
export function resolveGiftImage(gift, fallbackImage = DEFAULT_PLACEHOLDER_IMAGE) {
  const path = fragmentPath(gift)
  if (path) return `${FRAGMENT_GIFT_URL}/${path}.medium.jpg`
  return trimText(gift?.image) || fallbackImage
}

/** Maps a gift card from the search and inventory APIs to the fields the UI shows. */
export function mapGiftCard(gift) {
  const number = String(gift.number ?? '')
  const card = {
    ...gift,
    title: trimText(gift.collection_name) || 'Gift',
    number,
    numberLabel: `#${number}`,
    price: gift.price_nano != null ? formatGramAmount(gift.price_nano) : '0',
    model: trimText(gift.attributes?.model?.name) || 'Unknown',
    background: trimText(gift.attributes?.background?.name) || 'Unknown',
    symbol: trimText(gift.attributes?.symbol?.name) || 'Unknown',
    isOwnedByCurrentUser: gift.is_owned_by_current_user === true,
  }
  const path = fragmentPath(card)
  return {
    ...card,
    image: path ? `${FRAGMENT_GIFT_URL}/${path}.medium.jpg` : DEFAULT_PLACEHOLDER_IMAGE,
    lottieUrl: path ? `${FRAGMENT_GIFT_URL}/${path}.lottie.json` : '',
  }
}

export function mergeGiftPages(currentGifts, nextGifts) {
  if (!currentGifts.length) return nextGifts
  if (!nextGifts.length) return currentGifts
  return [...new Map([...currentGifts, ...nextGifts].map((gift) => [gift.id, gift])).values()]
}

// Every list API pages with an opaque next_cursor.
export function normalizePaginationPayload(rawPagination, fallbackLimit) {
  const limitRaw = Number.parseInt(String(rawPagination?.limit ?? ''), 10)
  const hasMore = rawPagination?.has_more === true
  return {
    limit: Number.isInteger(limitRaw) && limitRaw > 0 ? limitRaw : fallbackLimit,
    hasMore,
    nextCursor: hasMore ? rawPagination?.next_cursor ?? null : null,
  }
}

export function createInitialPagination(limit) {
  return { limit, hasMore: false, nextCursor: null }
}
