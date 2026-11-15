import test from 'node:test'
import assert from 'node:assert/strict'
import { authSettings, trustProxy } from '../src/security.js'
import { addNano, feeNano } from '../src/modules/wallet/wallet-money.utils.js'

test('production requires a secret and forbids development authentication', () => {
  assert.throws(() => authSettings({ NODE_ENV: 'production' }))
  assert.throws(() => authSettings({ JWT_SECRET: 'a'.repeat(32), NODE_ENV: 'production', ALLOW_DEV_AUTH: 'true' }))
  assert.equal(authSettings({ JWT_SECRET: 'a'.repeat(32) }).allowDevAuth, false)
})
test('money operations reject balance overflow and calculate fees exactly', () => {
  assert.throws(() => addNano(Number.MAX_SAFE_INTEGER, 1))
  assert.equal(feeNano(Number.MAX_SAFE_INTEGER, 9999), BigInt(Number.MAX_SAFE_INTEGER) * 9999n / 10000n)
  assert.throws(() => addNano('1.5', 1), RangeError)
})
test('only a configured proxy can supply the client address', () => {
  const previous = process.env.TRUSTED_PROXY_ADDRESSES
  try {
    process.env.TRUSTED_PROXY_ADDRESSES = '127.0.0.1'
    // Express walks X-Forwarded-For from the right; only the socket peer (hop 0) may be trusted.
    assert.equal(trustProxy('other', 0), false)
    assert.equal(trustProxy('127.0.0.1', 0), true)
    assert.equal(trustProxy('127.0.0.1', 1), false)
  } finally {
    if (previous === undefined) delete process.env.TRUSTED_PROXY_ADDRESSES
    else process.env.TRUSTED_PROXY_ADDRESSES = previous
  }
})
