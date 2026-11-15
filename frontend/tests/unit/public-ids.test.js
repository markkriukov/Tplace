import test from 'node:test'
import assert from 'node:assert/strict'
import { selectCartEntries } from '../../src/features/cart/lib/cart-state.js'
import { purchasePayload } from '../../src/features/gifts/lib/gift-purchase-payload.js'
import { formatWalletActions, formatProfileHistoryItems } from '../../src/features/wallet/lib/wallet-formatters.js'
import { formatProfileOfferItems } from '../../src/features/offers/lib/offer-formatters.js'
import { translations } from '../../src/shared/i18n/translations.js'

const t = (key) => translations.en[key] ?? key
import { mapNewsItemFromApi } from '../../src/features/news/lib/news-utils.js'
import { mapSalesHistoryItem } from '../../src/features/sales-history/lib/sales-history-utils.js'

const first = '019a0000-0000-7000-8000-000000000001'
const second = '019a0000-0000-7000-8000-000000000002'

test('UUID cart entries stay distinct and preserve the selected quote', () => {
  const selected = { id: first, listing_id: second, price_nano: '1234567891' }
  const other = { id: second }
  assert.deepEqual(selectCartEntries([selected], [first, second], [{ ...selected, price_nano: '5' }, other]), [selected, other])
  const payload = purchasePayload(selected)
  assert.equal(payload.id, first)
  assert.equal(payload.listing_id, second)
  assert.equal(payload.expected_price_nano, '1234567891')
})

test('wallet, offer, news and sale cards preserve UUID IDs and gift numbers', () => {
  const tx = { id: first, tx_kind: 'deposit', amount_nano: '1', related_gift_id: second, related_gift: { title: 'Gift', number: '12' } }
  assert.equal(formatWalletActions([tx], 'GRAM', t)[0].id, first)
  assert.equal(formatProfileHistoryItems([tx], t)[0].numberLabel, '#12')
  assert.equal(formatProfileOfferItems([{ id: first, gift_id: second, gift: { number: '12' } }], t)[0].id, first)
  assert.equal(mapNewsItemFromApi({ id: first }).id, first)
  assert.equal(mapSalesHistoryItem({ id: first, gift_id: second }).id, first)
  assert.equal(mapSalesHistoryItem({ id: first, gift_id: second }).gift_id, second)
})
