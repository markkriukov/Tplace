import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

process.env.DATABASE_URL ??= 'postgresql://unused:unused@127.0.0.1:1/config_test'
const { readMarketplaceFeeBps } = await import('../src/config.js')

test('marketplace fee defaults to 0.5 percent in code and deployment examples', () => {
  assert.equal(readMarketplaceFeeBps({}), 50)
  for (const path of ['../../../.env.example', '../../../docker-compose.yml', '../../../docker-compose.prod.yml']) {
    const text = readFileSync(new URL(path, import.meta.url), 'utf8')
    assert.match(text, /MARKETPLACE_FEE_BPS(?:=50|(?:=|: )\$\{MARKETPLACE_FEE_BPS:-50\})/)
  }
})

test('fee configuration accepts explicit bounds and rejects malformed settings', () => {
  for (const value of ['0', '50', '10000']) assert.equal(readMarketplaceFeeBps({ MARKETPLACE_FEE_BPS: value }), Number(value))
  for (const value of ['', ' ', '-1', '10001', '0.5', '50junk', '5e1', 'Infinity']) {
    assert.throws(() => readMarketplaceFeeBps({ MARKETPLACE_FEE_BPS: value }), /MARKETPLACE_FEE_BPS/)
  }
})
