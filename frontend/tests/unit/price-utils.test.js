import test from 'node:test'
import assert from 'node:assert/strict'
import { getPriceDetails, normalizePriceInput } from '../../src/features/gifts/lib/gift-price-utils.js'

const pricing = { minPrice: 1, maxPrice: 100, marketplaceFeeBps: 50 }

test('price input preserves decimal editing with a comma or point', () => {
  assert.equal(normalizePriceInput('00012,'), '12,')
  assert.equal(normalizePriceInput(',25'), '0,25')
  assert.equal(normalizePriceInput('00012.34'), '12.34')
  assert.equal(normalizePriceInput(''), '')
})

test('price input rejects malformed amounts without changing their meaning', () => {
  for (const value of ['-10', '1e3', '1.2.3', '1,2.3', ' 0012.3.4 GRAM', '10 GRAM']) {
    const normalized = normalizePriceInput(value)
    assert.equal(normalized, value)
    assert.equal(getPriceDetails(normalized, pricing).isInvalid, true)
  }
})

test('selling and offers use the same price limits and fee preview', () => {
  const details = getPriceDetails('12,5', pricing)
  assert.equal(details.isInvalid, false)
  assert.equal(details.formattedAmount, '12.5')
  assert.equal(getPriceDetails('1.000000001', pricing).formattedAmount, '1.000000001')
  assert.equal(getPriceDetails('001,234567890', pricing).formattedAmount, '1.23456789')
  for (const value of ['1.0000000001', '1abc', 'Infinity', '1e2']) {
    assert.equal(getPriceDetails(value, pricing).isInvalid, true)
  }
  assert.equal(details.feePercentLabel, '0.5')
  assert.equal(details.feeAmountLabel, '0.0625')
  assert.equal(details.sellerReceiveLabel, '12.4375')
  assert.equal(getPriceDetails('1', pricing).isInvalid, false)
  assert.equal(getPriceDetails('100', pricing).isInvalid, false)
  assert.equal(getPriceDetails('0.99', pricing).isBelowMin, true)
  assert.equal(getPriceDetails('100.01', pricing).isAboveMax, true)
  assert.equal(getPriceDetails('', pricing).isInvalid, true)
  assert.equal(getPriceDetails('12.5', null).isInvalid, true)
  assert.equal(getPriceDetails('12.5', { ...pricing, marketplaceFeeBps: 10_001 }).isInvalid, true)
})
