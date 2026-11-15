import { publicIdPattern } from './public-id.js'

const nanoAmount = { anyOf: [{ type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER }, { type: 'string', format: 'safe-id' }] }
export const id = { type: 'string', format: 'uuid', pattern: publicIdPattern }
const externalId = { anyOf: [{ type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER }, { type: 'string', pattern: '^[1-9][0-9]{0,18}$', format: 'bigint-id' }] }
const text = (maxLength, minLength = 0) => ({ type: 'string', minLength, maxLength })
const amount = { anyOf: [{ type: 'number', exclusiveMinimum: 0, maximum: Number.MAX_SAFE_INTEGER / 1e9 }, { type: 'string', maxLength: 30, pattern: '^(?:[0-9]+[.,]?[0-9]{0,9}|[.,][0-9]{1,9})$' }] }
// A price filter bound; zero is a real bound for unlisted inventory.
const priceBound = { type: 'string', maxLength: 30, pattern: '^(?:[0-9]+(?:[.,][0-9]{1,9})?|[.,][0-9]{1,9})$' }
const requestKey = { type: 'string', pattern: '^[a-zA-Z0-9_-]{1,128}$' }
const integer = (minimum, maximum) => ({ anyOf: [{ type: 'integer', minimum, maximum }, { type: 'string', pattern: '^[0-9]{1,9}$' }] })
export function object(properties, required = []) {
  return { type: 'object', properties, required, additionalProperties: false }
}
const list = (item) => ({ anyOf: [item, { type: 'array', items: item, maxItems: 200 }] })
const catalogId = { anyOf: [{ type: 'integer', minimum: 1, maximum: 2147483647 }, { type: 'string', pattern: '^[1-9][0-9]{0,9}$' }] }
const filters = Object.fromEntries(['collection', 'model', 'background', 'symbol'].flatMap((key) => [
  [key, list(text(500))], [`${key}_id`, list({ anyOf: [catalogId, { type: 'string', pattern: '^[1-9][0-9]*(,[1-9][0-9]*)*$', maxLength: 4000 }] })],
]))
export const SEARCH_SORTS = ['price', 'created', 'giftNumber', 'collection', 'modelRarity', 'backgroundRarity', 'symbolRarity']
  .flatMap((key) => [`${key}Asc`, `${key}Desc`])
// What a search matches; filter counts take only these.
const criteriaFields = { ...filters, q: text(200), price_min: priceBound, price_max: priceBound }
const searchFields = {
  ...criteriaFields,
  sort: { enum: SEARCH_SORTS },
  limit: integer(1, 500),
  cursor: text(8192),
}
const user = { id: externalId, username: { anyOf: [text(100), { type: 'null' }] }, first_name: { anyOf: [text(200), { type: 'null' }] } }
const news = { title: { ...text(200, 1), pattern: '\\S' }, content: { ...text(50_000, 1), pattern: '\\S' }, lead: text(2000), image_url: { ...text(2048), pattern: '^(https?://|/|$)' }, is_published: { type: 'boolean' } }
export const schemas = {
  giftImport: object({
    username: { type: 'string', pattern: '^@?[A-Za-z][A-Za-z0-9_]{3,31}$', maxLength: 33 },
    max_count: { type: 'integer', minimum: 1, maximum: 1000 },
    request_key: requestKey,
  }, ['username', 'max_count', 'request_key']),
  empty: object({}),
  search: object(searchFields),
  salesHistory: object({ ...searchFields, sort: { enum: ['soldDesc', 'soldAsc', 'priceAsc', 'priceDesc'] } }),
  inventory: object({ ...searchFields, listed: { enum: ['true', 'false'] }, summary: { enum: ['true', 'false'] } }, ['listed']),
  giftList: object({ id, price: amount }, ['id', 'price']),
  giftBuy: object({ id, listing_id: id, expected_price_nano: nanoAmount }, ['id', 'listing_id', 'expected_price_nano']),
  giftCancel: object({ id }, ['id']),
  giftWithdraw: object({ id, request_key: requestKey, expected_fee_nano: nanoAmount }, ['id']),
  offerCreate: object({ gift_id: id, amount, expires_in_hours: integer(1, 720) }, ['gift_id', 'amount']),
  walletChange: object({ amount, idempotency_key: requestKey, wallet_address: text(100, 1), network: { enum: ['-239', '-3'] } }, ['amount', 'idempotency_key', 'wallet_address', 'network']),
  loginTelegram: object({ initData: text(16_384, 1) }, ['initData']),
  loginDevelopment: object(user, ['id']),
  newsCreate: object(news, ['title', 'content']),
  newsUpdate: { ...object(news), minProperties: 1 },
  filters: object({ collection: text(200), collection_regular_id: externalId }),
  filterCounts: object(criteriaFields),
  walletHistory: object({ limit: integer(1, 100), cursor: id }),
  limit: object({ limit: integer(1, 200) }),
  offers: object({ limit: integer(1, 200), cursor: id, role: { enum: ['incoming', 'outgoing', 'all'] }, status: { enum: ['pending', 'accepted', 'rejected', 'canceled', 'expired', 'all'] } }),
}
