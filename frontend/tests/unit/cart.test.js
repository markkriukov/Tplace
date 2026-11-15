import test from 'node:test'
import assert from 'node:assert/strict'
import { selectCartEntries } from '../../src/features/cart/lib/cart-state.js'
test('cart survives filtering and retains the price the user selected', () => {
  const gift = { id: 1, listing_id: 2, price_nano: '1234567890' }
  const selected = selectCartEntries([], [1], [gift])
  assert.deepEqual(selectCartEntries(selected, ids => ids, []), [gift])
  assert.deepEqual(selectCartEntries(selected, [1], [{ ...gift, price_nano: '9000000000' }]), [gift])
  assert.deepEqual(selectCartEntries(selected, [], []), [])
})
