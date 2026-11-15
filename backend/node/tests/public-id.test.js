import test from 'node:test'
import assert from 'node:assert/strict'
import { isPublicId, parsePublicId } from '../src/http/public-id.js'
import { schemas } from '../src/http/schemas.js'
import { validator } from '../src/http/validation.js'
import { mapGiftToPayload } from '../src/modules/gifts/gifts.mapper.js'
import { mapOfferPayload } from '../src/modules/offers/offers.mapper.js'
import { mapWalletTransactionPayload } from '../src/modules/wallet/wallet.mapper.js'

const giftId = '019a0000-0000-7000-8000-000000000001'
const entityId = '019a0000-0000-7000-8000-000000000002'

test('public references require UUIDv7 while nano amounts remain integers', () => {
  assert.ok(isPublicId(giftId))
  assert.equal(parsePublicId(giftId.toUpperCase()), giftId)
  const buy = validator(schemas.giftBuy)
  const input = { id: giftId, listing_id: entityId, expected_price_nano: '9007199254740991' }
  assert.doesNotThrow(() => buy(input))
  for (const id of [1, '1', entityId.replace('-7000-', '-4000-'), entityId.replace('-8000-', '-0000-'), entityId + 'extra']) {
    assert.equal(isPublicId(id), false)
    assert.throws(() => buy({ ...input, id }), { statusCode: 400 })
  }
  assert.throws(() => buy({ ...input, expected_price_nano: giftId }), { statusCode: 400 })
  assert.throws(() => buy({ ...input, expected_price_nano: '9007199254740992' }), { statusCode: 400 })
  const search = validator(schemas.search)
  assert.doesNotThrow(() => search({ collection_id: '1,2', model_id: ['1', '2'], background_id: '3', symbol_id: '4' }))
  assert.throws(() => search({ collection_id: giftId }), { statusCode: 400 })
})

test('gift, offer and wallet mappers expose public IDs and nullable gift references', () => {
  const gift = { pk_gift_id: 123, public_id: giftId, name: 'Gift-12' }
  const card = mapGiftToPayload({ ...gift, listing_id: entityId, price_nano: '1' })
  assert.equal(card.id, giftId)
  assert.equal(card.listing_id, entityId)
  assert.equal(card.pk_gift_id, undefined)
  const offer = mapOfferPayload({ pk_offer_id: 456, public_id: entityId, fk_gift_id: 123, Gift: gift })
  assert.equal(offer.id, entityId)
  assert.equal(offer.gift_id, giftId)
  assert.equal(offer.pk_offer_id, undefined)
  assert.equal(offer.fk_gift_id, undefined)
  const tx = mapWalletTransactionPayload({ pk_wallet_tx_id: 456, public_id: entityId, related_gift_id: 123, Gift: gift })
  assert.equal(tx.id, entityId)
  assert.equal(tx.related_gift_id, giftId)
  assert.equal(tx.pk_wallet_tx_id, undefined)
  assert.equal(mapOfferPayload({ public_id: entityId }).gift_id, null)
  assert.equal(mapWalletTransactionPayload({ public_id: entityId }).related_gift_id, null)
})
