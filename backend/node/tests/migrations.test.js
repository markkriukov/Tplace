import test from 'node:test'
import assert from 'node:assert/strict'
import { isPublicId } from '../src/http/public-id.js'

test('initial migration creates the complete schema with integer keys and UUIDv7 defaults',
  { skip: !process.env.TEST_DATABASE_URL }, async t => {
    const url = new URL(process.env.TEST_DATABASE_URL)
    assert.match(url.pathname, /_test$/)
    process.env.DATABASE_URL = url.toString()
    const { Sequelize } = await import('sequelize')
    const { sequelize } = await import('../src/db/sequelize.js')
    const { migrateDatabase, readMigrations } = await import('../src/db/migrations.js')
    const databaseName = `tplace_initial_${Date.now()}_test`
    const admin = new Sequelize(url.toString(), { logging: false })
    await admin.query(`CREATE DATABASE "${databaseName}"`)
    url.pathname = `/${databaseName}`
    const database = new Sequelize(url.toString(), { logging: false })
    t.after(async () => {
      await database.close()
      await admin.query(`DROP DATABASE "${databaseName}"`)
      await admin.close()
      await sequelize.close()
    })
    const names = ['001_initial.sql']
    assert.deepEqual((await readMigrations()).map(row => row.name), names)
    assert.deepEqual(await migrateDatabase({ database }), names)
    assert.deepEqual(await migrateDatabase({ database }), [])
    const [columns] = await database.query(`SELECT table_name,column_name,data_type,column_default
      FROM information_schema.columns WHERE table_schema='public'`)
    const keys = columns.filter(row => /^(pk_|fk_)/.test(row.column_name))
    assert.ok(keys.length > 40)
    assert.ok(keys.every(row => row.data_type === 'integer'))
    // Surrogate keys are named pk_/fk_ and Telegram identifiers telegram_*; flags
    // start with is_ and timestamps end with _at.
    assert.deepEqual(columns.filter(row => row.column_name === 'id' ||
      (row.data_type === 'boolean' && !row.column_name.startsWith('is_')) ||
      (row.data_type.startsWith('timestamp') && !row.column_name.endsWith('_at'))), [])
    // Standalone indexes are named idx_<table>_<purpose>.
    const [indexes] = await database.query(`SELECT indexname FROM pg_indexes WHERE schemaname = 'public'
      AND indexname NOT LIKE 'idx\\_%' AND indexname NOT IN (SELECT conname FROM pg_constraint)`)
    assert.deepEqual(indexes, [])
    const publicColumns = columns.filter(row => row.column_name === 'public_id')
    assert.equal(publicColumns.length, 10)
    assert.ok(publicColumns.every(row => !['collections', 'models', 'backgrounds', 'symbols'].includes(row.table_name)))
    assert.ok(publicColumns.every(row => row.data_type === 'uuid' && row.column_default === 'uuidv7()'))
    assert.ok(columns.filter(row => row.column_name === 'currency_code').every(row => row.column_default === "'GRAM'::text"))
    await database.query(`INSERT INTO users(telegram_id) VALUES (9223372036854775807);
      INSERT INTO collections(short_name,display_name) VALUES ('test','Test');
      INSERT INTO models(fk_collection_id,name,rarity) VALUES (1,'Model','2,5%');
      INSERT INTO backgrounds(name) VALUES ('Backdrop');
      INSERT INTO symbols(name) VALUES ('Symbol');
      INSERT INTO collection_backgrounds(fk_collection_id,fk_background_id) VALUES (1,1);
      INSERT INTO collection_symbols(fk_collection_id,fk_symbol_id) VALUES (1,1);
      INSERT INTO gifts(telegram_gift_id,name,fk_collection_id,fk_model_id,fk_background_id,fk_symbol_id)
        VALUES (9223372036854775807,'Test-12',1,1,1,1);
      INSERT INTO ownerships(fk_user_id,fk_gift_id) VALUES (1,1);
      INSERT INTO wallet_transactions(fk_user_id,tx_kind,direction,status,amount_nano)
        VALUES (1,'deposit','credit','completed',1);
      INSERT INTO marketplace_fee_entries(fk_legacy_wallet_tx_id,amount_nano) VALUES (1,1);`)
    const [gifts] = await database.query('SELECT gift_number,public_id FROM gifts')
    assert.equal(gifts[0].gift_number, '12')
    assert.equal((await database.query('SELECT search_name FROM gifts'))[0][0].search_name, 'test12')
    // Inserting a user creates its wallet; the upsert that signs in again does not.
    await database.query("INSERT INTO users(telegram_id) VALUES (9223372036854775807) ON CONFLICT (telegram_id) DO UPDATE SET username='again'")
    assert.deepEqual((await database.query('SELECT fk_user_id, available_nano, locked_nano FROM wallet_balances'))[0],
      [{ fk_user_id: 1, available_nano: '0', locked_nano: '0' }])
    assert.ok(isPublicId(gifts[0].public_id))
    assert.ok(Math.abs(parseInt(gifts[0].public_id.replaceAll('-', '').slice(0,12),16) - Date.now()) < 10_000)
    assert.equal((await database.query('SELECT rarity_numeric FROM models'))[0][0].rarity_numeric, '2.5')
    await assert.rejects(database.query('INSERT INTO ownerships(fk_user_id,fk_gift_id) VALUES (1,1)'), { name: 'SequelizeUniqueConstraintError' })
    // Model, backdrop and symbol must belong to the gift's collection.
    await database.query(`INSERT INTO collections(short_name,display_name) VALUES ('other','Other');
      INSERT INTO backgrounds(name) VALUES ('Unlinked')`)
    const insertGift = (collection, backdrop) => database.query(`INSERT INTO gifts(telegram_gift_id,name,fk_collection_id,fk_model_id,fk_background_id,fk_symbol_id)
      VALUES (1,'Test-1',${collection},1,${backdrop},1)`)
    await assert.rejects(insertGift(2, 1), { name: 'SequelizeForeignKeyConstraintError' })
    await assert.rejects(insertGift(1, 2), { name: 'SequelizeForeignKeyConstraintError' })
    await assert.rejects(database.query('INSERT INTO users(telegram_id,public_id) SELECT 2,public_id FROM users'), { name: 'SequelizeUniqueConstraintError' })
    await assert.rejects(database.query('UPDATE marketplace_fee_entries SET amount_nano=2'), /append-only/)
    await assert.rejects(database.query('DELETE FROM marketplace_fee_entries'), /append-only/)
    await assert.rejects(database.query('TRUNCATE marketplace_fee_entries'), /append-only/)
    const [ids] = await database.query('SELECT uuidv7() AS id FROM generate_series(1,1000)')
    assert.equal(new Set(ids.map(row => row.id)).size, 1000)
    assert.ok(ids.every(row => isPublicId(row.id)))
    // The schema rejects the anomalies its composite keys and checks rule out.
    const [[{ pk_user_id: buyer }]] = await database.query('INSERT INTO users(telegram_id) VALUES (2) RETURNING pk_user_id')
    const [[{ pk_gift_id: otherGift }]] = await database.query(`INSERT INTO gifts(telegram_gift_id,name,fk_collection_id,fk_model_id,fk_background_id,fk_symbol_id)
      VALUES (2,'Test-2',1,1,1,1) RETURNING pk_gift_id`)
    const [[{ pk_offer_id: offer }]] = await database.query(`INSERT INTO offers(fk_gift_id,fk_buyer_user_id,fk_seller_user_id,amount_nano)
      VALUES (1,:buyer,1,5) RETURNING pk_offer_id`, { replacements: { buyer } })
    const [[{ pk_deposit_id: deposit }]] = await database.query(`INSERT INTO telegram_gift_deposits(custodian_telegram_id,message_id,chat_id,
      sender_telegram_id,fk_gift_id,owned_gift_id,received_gift_id,status,received_at) VALUES (1,1,1,1,1,'1','1','credited',now()) RETURNING pk_deposit_id`)
    const rejects = (sql, name, replacements = {}) => assert.rejects(database.query(sql, { replacements }), { name })
    await rejects('UPDATE wallet_balances SET available_nano=9007199254740991, locked_nano=1 WHERE fk_user_id=1', 'SequelizeDatabaseError')
    // A closed listing's reason determines its status.
    await rejects("INSERT INTO gift_listings(fk_gift_id,fk_seller_user_id,price_nano,status) VALUES (1,1,1,'canceled')", 'SequelizeDatabaseError')
    await rejects("INSERT INTO gift_listings(fk_gift_id,fk_seller_user_id,price_nano,status,closed_reason) VALUES (1,1,1,'sold','canceled_by_seller')", 'SequelizeDatabaseError')
    await rejects(`INSERT INTO wallet_transactions(fk_user_id,tx_kind,direction,status,amount_nano,fk_offer_id,fk_counterparty_user_id)
      VALUES (1,'offer_purchase','debit','completed',1,:offer,:buyer)`, 'SequelizeDatabaseError', { offer, buyer })
    // A payment's user must be its ledger entry's user (entry 1 belongs to user 1).
    await rejects(`INSERT INTO ton_payments(fk_user_id,fk_wallet_tx_id,idempotency_key,kind,status,network,treasury_address,wallet_address,amount_nano,memo,valid_until)
      VALUES (:buyer,1,'k','deposit','pending','-3','t','w',1,'m',1)`, 'SequelizeForeignKeyConstraintError', { buyer })
    // A withdrawal's gift must be its deposit's gift.
    await rejects("INSERT INTO gift_withdrawals(fk_gift_id,fk_deposit_id,fk_user_id,request_key) VALUES (:otherGift,:deposit,1,'k')",
      'SequelizeForeignKeyConstraintError', { otherGift, deposit })
    await database.query("INSERT INTO gift_withdrawals(fk_gift_id,fk_deposit_id,fk_user_id,request_key) VALUES (1,:deposit,1,'k')",
      { replacements: { deposit } })
  })
