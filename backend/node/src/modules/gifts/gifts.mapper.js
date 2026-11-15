import { GIFT_IMAGES } from '../../config.js'

/** @param {unknown} seed */
function pickGiftImage(seed) {
  return GIFT_IMAGES[Math.abs(Number(seed) || 0) % GIFT_IMAGES.length]
}

/** Splits an NFT slug such as "PlushPepe-12" into its title and number.
 * @param {unknown} rawName @param {string | number} fallbackNumber */
export function splitGiftName(rawName, fallbackNumber) {
  const safeName = typeof rawName === 'string' ? rawName.trim() : ''
  const match = safeName.match(/^(.*?)-(\d+)$/)
  if (match) return { title: match[1].trim() || 'Gift', number: match[2] }
  return { title: safeName || 'Gift', number: String(fallbackNumber) }
}

/** @param {{pk_gift_id?: number | null, name?: string} | null | undefined} gift */
export function mapGiftSummary(gift) {
  // A raw nested row has a Gift object of NULLs when the gift was deleted.
  if (gift?.pk_gift_id == null) return null
  const id = Number(gift.pk_gift_id)
  return { ...splitGiftName(gift.name, id), image: pickGiftImage(id) }
}

/** @param {{title: string, number: string}} parsedName @param {number} fallbackNumber */
export function buildFragmentGiftImage(parsedName, fallbackNumber) {
  const slug = parsedName.title.toLowerCase().replace(/[^a-z0-9]+/g, '')
  const number = parsedName.number.replace(/\D/g, '')
  if (!slug || !number) return pickGiftImage(fallbackNumber)
  return `https://nft.fragment.com/gift/${slug}-${number}.medium.jpg`
}

/** @param {unknown} value */
const rarity = (value) => (value == null || !String(value).trim() ? null : String(value).trim())

/** Maps a gift card row from the search query.
 * @param {Record<string, any>} row */
export function mapGiftToPayload(row) {
  const parsedName = splitGiftName(row.name, Number(row.pk_gift_id))
  return {
    id: row.public_id,
    is_test_import: row.is_test_import === true,
    number: parsedName.number,
    price_nano: row.price_nano == null ? null : String(row.price_nano),
    listed_at: row.listed_at ?? null,
    listing_id: row.listing_id ?? null,
    collection_name: row.collection_name,
    attributes: {
      model: { name: row.model_name, rarity: row.model_rarity ?? null },
      background: { name: row.background_name, rarity: rarity(row.background_rarity) },
      symbol: { name: row.symbol_name, rarity: rarity(row.symbol_rarity) },
    },
    is_owned_by_current_user: row.is_owned === true,
  }
}
