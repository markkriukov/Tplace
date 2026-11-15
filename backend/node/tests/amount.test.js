import test from 'node:test'
import assert from 'node:assert/strict'

test('nano amounts are exact, bounded and reject malformed decimals', async () => {
  process.env.DATABASE_URL ||= 'postgresql://unused:unused@localhost/unused_test'
  const { parseAmountToNano } = await import('../src/modules/wallet/wallet-money.utils.js')
  assert.equal(parseAmountToNano('1,000000001'), 1000000001n)
  assert.equal(parseAmountToNano(0.000000001), 1n)
  assert.equal(parseAmountToNano('.5'), 500000000n)
  assert.equal(parseAmountToNano('9007199.254740991'), 9007199254740991n)
  for (const value of ['1abc', '1.0000000001', '99999999999999999', 1e-10, 0, -1, null]) {
    assert.equal(parseAmountToNano(value), null, String(value))
  }
})

test('public gift prices and offer amounts are exact nano strings', async () => {
  process.env.DATABASE_URL ||= 'postgresql://unused:unused@localhost/unused_test'
  const { formatNanoAmount } = await import('../src/modules/wallet/wallet-money.utils.js')
  const { mapOfferPayload } = await import('../src/modules/offers/offers.mapper.js')
  const { mapSalesHistoryPayload } = await import('../src/modules/catalog/sales-history/sales-history.mapper.js')
  const { mapGiftToPayload } = await import('../src/modules/gifts/gifts.mapper.js')
  for (const nano of ['1', '1000000001', '9007199254740991']) {
    assert.equal(mapOfferPayload({ amount_nano: nano }).amount_nano, nano)
    assert.equal(mapSalesHistoryPayload({ price_nano: nano }).price_nano, nano)
    assert.equal(mapGiftToPayload({ pk_gift_id: 1, price_nano: nano }).price_nano, nano)
    const [whole, fraction = ''] = formatNanoAmount(nano).split('.')
    assert.equal(BigInt(whole) * 1000000000n + BigInt(fraction.padEnd(9, '0')), BigInt(nano))
  }
})

test('wallet rows are read as checked integers and a broken ledger is never zero-filled', async () => {
  const { walletNano } = await import('../src/modules/wallet/wallet-money.utils.js')
  // The total is derived from the two stored balances.
  assert.deepEqual(walletNano({ available_nano: '7', locked_nano: '3' }), { available: 7n, locked: 3n, total: 10n })
  assert.throws(() => walletNano({ available_nano: '7', locked_nano: null }), /incomplete/)
  assert.throws(() => walletNano({ available_nano: '-1', locked_nano: '1' }), RangeError)
  assert.throws(() => walletNano({ available_nano: String(Number.MAX_SAFE_INTEGER), locked_nano: '1' }), { code: 'BALANCE_LIMIT' })
})

test('an escrow larger than the locked balance stops release instead of shrinking it', async () => {
  process.env.DATABASE_URL ||= 'postgresql://unused:unused@localhost/unused_test'
  const { releaseOfferEscrow } = await import('../src/modules/offers/offers-escrow.service.js')
  const wallet = { available_nano: '0', locked_nano: '5', save: async () => assert.fail('must not save') }
  const offer = { pk_offer_id: 1, fk_buyer_user_id: 2, fk_gift_id: 3, escrow_locked_nano: '6' }
  await assert.rejects(releaseOfferEscrow(offer, {}, 'expired', new Map([['2', wallet]])), /exceeds the locked balance/)
  assert.equal(offer.escrow_locked_nano, '6')
})
