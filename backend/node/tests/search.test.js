import test from 'node:test'
import assert from 'node:assert/strict'

process.env.DATABASE_URL ??= 'postgresql://unused:unused@127.0.0.1:1/audit_test'
const { buildGiftSearchQuery } = await import('../src/modules/catalog/search/search.repository.js')
const { parseSearchCriteria, addGiftSearchCriteriaConditions } = await import('../src/modules/catalog/search/search.criteria.js')

test('cursor validation rejects bigint fractions, overflow and impossible dates before SQL', () => {
  for (const [sort, invalid] of [['priceAsc', ['1.5', '9223372036854775808', '-9223372036854775809']],
    ['createdAsc', ['2026-99-99 99:99:99', '2026-02-30 12:00:00', '0000-01-01 00:00:00']]]) {
    const criteria = parseSearchCriteria(new URLSearchParams({ sort }))
    const scope = buildGiftSearchQuery({ limit: 2, criteria }).scope
    for (const value of invalid) {
      const cursor = Buffer.from(JSON.stringify({ scope, id: '019a0000-0000-7000-8000-000000000001', value })).toString('base64url')
      assert.throws(() => buildGiftSearchQuery({ limit: 2, criteria: { ...criteria, cursor } }), { statusCode: 400 })
    }
    const value = sort === 'priceAsc' ? '9223372036854775807' : '2026-10-08 12:00:00.123456'
    const cursor = Buffer.from(JSON.stringify({ scope, id: '019a0000-0000-7000-8000-000000000001', value })).toString('base64url')
    assert.equal(buildGiftSearchQuery({ limit: 2, criteria: { ...criteria, cursor } }).replacements.cursorValue, value)
  }
})

test('zero maximum price remains a real bound for unlisted inventory', () => {
  const criteria = parseSearchCriteria(new URLSearchParams({ price_max: '0' }))
  const where = []
  const replacements = {}
  addGiftSearchCriteriaConditions(where, replacements, criteria, { priceSql: 'coalesce(gl.price_nano,0)' })
  assert.equal(replacements.priceMaxNano, 0)
  assert.ok(where.includes('coalesce(gl.price_nano,0) <= :priceMaxNano'))
})

