import test from 'node:test'
import assert from 'node:assert/strict'
import { mapGiftCard, resolveGiftImage } from '../../src/features/gifts/lib/gift-utils.js'

test('gift cards derive Fragment media from their collection and number', () => {
  const base = 'https://nft.fragment.com/gift/'
  const cases = [
    [{ collection_name: 'Crystal Fox', number: '123' }, `${base}crystalfox-123.medium.jpg`, `${base}crystalfox-123.lottie.json`],
    [{ collection_name: 'B-Day Candle', number: '7' }, `${base}bdaycandle-7.medium.jpg`, `${base}bdaycandle-7.lottie.json`],
    [{ collection_name: '---', number: '9' }, '/gifts/signal-orb.svg', ''],
    [{}, '/gifts/signal-orb.svg', ''],
  ]
  for (const [gift, image, lottieUrl] of cases) {
    const card = mapGiftCard(gift)
    assert.equal(card.image, image)
    assert.equal(card.lottieUrl, lottieUrl)
  }
})

test('gift cards expose API attributes and exact prices under UI names', () => {
  const card = mapGiftCard({
    id: 'a', number: '12', collection_name: 'Plush Pepe', price_nano: '1000000001', is_owned_by_current_user: true,
    attributes: { model: { name: 'Gold' }, background: { name: 'Blue' }, symbol: { name: 'Star' } },
  })
  assert.deepEqual([card.title, card.numberLabel, card.price, card.model, card.background, card.symbol, card.isOwnedByCurrentUser],
    ['Plush Pepe', '#12', '1.000000001', 'Gold', 'Blue', 'Star', true])
  assert.equal(mapGiftCard({ number: '1' }).price, '0')
})

test('gift summaries prefer Fragment artwork, then their own image, then the fallback', () => {
  assert.equal(resolveGiftImage({ title: 'Plush Pepe', number: '5' }), 'https://nft.fragment.com/gift/plushpepe-5.medium.jpg')
  assert.equal(resolveGiftImage({ image: '/gifts/lunar-toy.svg' }), '/gifts/lunar-toy.svg')
  assert.equal(resolveGiftImage({}, '/gifts/cyber-bloom.svg'), '/gifts/cyber-bloom.svg')
})
