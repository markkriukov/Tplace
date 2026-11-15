import assert from 'node:assert/strict'

// All fixture rows, index changes and statistics are confined to a test DB.
const url = new URL(process.env.TEST_DATABASE_URL)
assert.match(url.pathname, /_test$/, 'Use a disposable database ending in _test')
process.env.DATABASE_URL = url.toString()
const { sequelize, withoutTimeouts } = await import('../src/db/sequelize.js')
const { migrateDatabase } = await import('../src/db/migrations.js')
const { buildGiftSearchQuery } = await import('../src/modules/catalog/search/search.repository.js')
const { parseSearchCriteria } = await import('../src/modules/catalog/search/search.criteria.js')
const { encodeCursor } = await import('../src/http/keyset-cursor.js')
await migrateDatabase()
const transaction = await sequelize.transaction()
try {
  // Fixture inserts and EXPLAIN ANALYZE may outlast the API's statement timeout.
  await withoutTimeouts(transaction)
  const query = (sql, replacements = {}) => sequelize.query(sql, { replacements, transaction })
  const [[user]] = await query("INSERT INTO users (telegram_id, username) VALUES (8700000000000000000, 'profile') RETURNING pk_user_id AS id")
  const [[collection]] = await query("INSERT INTO collections (short_name, display_name) VALUES ('db-profile', 'DB profile') RETURNING pk_collection_id AS id")
  const [[model]] = await query("INSERT INTO models (fk_collection_id, name, rarity) VALUES (:collection, 'Profile', '15') RETURNING pk_model_id AS id", { collection: collection.id })
  const [[background]] = await query("INSERT INTO backgrounds (name) VALUES ('DB profile') RETURNING pk_background_id AS id")
  const [[symbol]] = await query("INSERT INTO symbols (name) VALUES ('DB profile') RETURNING pk_symbol_id AS id")
  const replacements = { user: user.id, collection: collection.id, model: model.id, background: background.id, symbol: symbol.id }
  await query(`INSERT INTO collection_backgrounds (fk_collection_id, fk_background_id) VALUES (:collection, :background);
    INSERT INTO collection_symbols (fk_collection_id, fk_symbol_id) VALUES (:collection, :symbol)`, replacements)
  await query(`INSERT INTO gifts (telegram_gift_id, name, fk_collection_id, fk_model_id, fk_background_id, fk_symbol_id)
    SELECT 8700000000000000000 + n, 'Profile-' || n, :collection, :model, :background, :symbol
    FROM generate_series(1, 50000) n`, replacements)
  await query(`INSERT INTO gift_listings (fk_gift_id, fk_seller_user_id, price_nano, status, listed_at)
    SELECT pk_gift_id, :user, gift_number::bigint * 1000000, 'active', timestamp '2025-01-01' + gift_number::bigint * interval '1 second'
    FROM gifts WHERE fk_collection_id = :collection`, replacements)
  for (const table of ['gifts', 'gift_listings', 'models', 'collections']) await query(`ANALYZE ${table}`)

  const profile = async (label, sql, params) => {
    const [rows] = await query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`, params)
    const result = rows[0]['QUERY PLAN'][0]
    const indexes = new Set()
    const visit = (node) => { if (node['Index Name']) indexes.add(node['Index Name']); for (const child of node.Plans ?? []) visit(child) }
    visit(result.Plan)
    console.log(JSON.stringify({ label, ms: result['Execution Time'], blocks: result.Plan['Shared Hit Blocks'], indexes: [...indexes] }))
  }
  const criteria = parseSearchCriteria(new URLSearchParams('sort=priceAsc'))
  const first = buildGiftSearchQuery({ limit: 25, criteria })
  // Preserve exact cursor values from the same uncommitted fixture.
  const [anchor] = await query(`SELECT g.public_id, gl.price_nano::text AS cursor_value FROM gift_listings gl
    JOIN gifts g ON g.pk_gift_id = gl.fk_gift_id WHERE gl.status = 'active'
    ORDER BY gl.price_nano, gl.fk_gift_id OFFSET 40000 LIMIT 1`)
  const cursor = encodeCursor(first.scope, anchor[0])
  const seek = buildGiftSearchQuery({ limit: 25, criteria: { ...criteria, cursor } })
  const recent = buildGiftSearchQuery({ limit: 25, criteria: parseSearchCriteria(new URLSearchParams('sort=createdDesc')) })
  const numbered = buildGiftSearchQuery({ limit: 25, criteria: parseSearchCriteria(new URLSearchParams('sort=giftNumberAsc')) })
  for (const [label, built] of [['price-first-indexed', first], ['price-cursor-40000', seek], ['date-first-indexed', recent], ['number-first-indexed', numbered]]) {
    await profile(label, built.sql, built.replacements)
  }
  await profile('worker-id-indexed', 'SELECT pk_gift_id FROM gifts WHERE telegram_gift_id = 8700000000000040000', {})
  await query('DROP INDEX idx_gift_listings_active_price, idx_gift_listings_active_date, idx_gifts_number, idx_gifts_telegram_gift_id_unique')
  await profile('price-first-without-index', first.sql, first.replacements)
  await profile('date-first-without-index', recent.sql, recent.replacements)
  await profile('number-first-without-index', numbered.sql, numbered.replacements)
  await profile('worker-id-without-index', 'SELECT pk_gift_id FROM gifts WHERE telegram_gift_id = 8700000000000040000', {})
} finally {
  await transaction.rollback()
  await sequelize.close()
}
