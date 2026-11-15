import test from 'node:test'
import assert from 'node:assert/strict'

const databaseUrl = process.env.TEST_DATABASE_URL

test('marketplace HTTP contracts and database transactions', { skip: !databaseUrl }, async (t) => {
  assert.match(new URL(databaseUrl).pathname, /_test$/, 'Use a dedicated database ending in _test')
  process.env.DATABASE_URL = databaseUrl
  process.env.TON_NETWORK = '-3'
  process.env.TON_TREASURY_ADDRESS = '0:' + '11'.repeat(32)
  process.env.TON_TREASURY_MNEMONIC = 'configured-for-mocked-payout-tests'
  process.env.TON_TREASURY_MNEMONIC_FILE = ''
  process.env.TON_PAYOUTS_ENABLED = 'true'
  process.env.TON_WITHDRAW_FEE_NANO = '50000000'
  const { sequelize } = await import('../src/db/sequelize.js')
  const { migrateDatabase } = await import('../src/db/migrations.js')
  const { createApp } = await import('../src/app.js')
  const { signToken } = await import('../src/modules/auth/auth-token.signer.js')
  const ledger = await import('../src/modules/wallet/wallet-ledger.service.js')
  // Fixture amounts are small numbers; compare them as numbers.
  const calculateMarketplaceFeeNano = amount => Number(ledger.calculateMarketplaceFeeNano(amount))
  const { recordMarketplaceFee, readMarketplaceRevenue } = await import('../src/modules/marketplace-fees/marketplace-fees.service.js')
  const { invalidateFiltersCatalogCache } = await import('../src/modules/catalog/filters/filters.service.js')
  const {
    User,
    Collection,
    GiftModel,
    Background,
    GiftSymbol,
    CollectionBackground,
    CollectionSymbol,
    Gift,
    Ownership,
    GiftListing,
    WalletBalance,
    WalletTransaction,
    Offer,
    MarketplaceFeeEntry,
  } = await import('../src/db/models.js')
  await migrateDatabase()
  const custodian = await User.create({ telegram_id: String(Date.now() * 1000 + 800000), username: 'test_custodian' })
  process.env.CUSTODY_TELEGRAM_USER_ID = String(custodian.telegram_id)
  await sequelize.query('INSERT INTO gift_custody_snapshots(fk_user_id, completed_run) VALUES (:user, 1)', {
    replacements: { user: custodian.pk_user_id },
  })
  const server = await new Promise((resolve) => {
    const listening = createApp({ rateLimit: { maxRequests: 10000, maxWrites: 10000, maxAuth: 10000 } }).listen(0, '127.0.0.1', () => resolve(listening))
  })
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve))
    await sequelize.close()
  })
  const withdrawalKey = async publicId => (await sequelize.query('SELECT pk_gift_withdrawal_id FROM gift_withdrawals WHERE public_id=:publicId', { replacements: { publicId } }))[0][0].pk_gift_withdrawal_id
  const base = `http://127.0.0.1:${server.address().port}`
  const request = async (path, { user, body, method = body ? 'POST' : 'GET' } = {}) => {
    const token = user
      ? signToken({
          sub: user.public_id,
          ver: user.token_version ?? 0,
          exp: Math.floor(Date.now() / 1000) + 600,
        })
      : null
    const response = await fetch(base + path, {
      signal: AbortSignal.timeout(10000),
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    return { status: response.status, data: await response.json() }
  }
  const getInventory = (user, params = {}) => {
    const query = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) {
      for (const item of [value].flat()) if (item != null) query.append(key, String(item))
    }
    return request(`/my/inventory?${query}`, { user })
  }
  let nextId = Date.now() * 1000
  const observe = (gift) => sequelize.query('INSERT INTO gift_custody_observations(fk_gift_id, fk_custodian_user_id, is_present) VALUES (:gift, :user, true)', {
    replacements: { gift: gift.pk_gift_id, user: custodian.pk_user_id },
  })
  const fixture = async () => {
    const id = String(nextId++)
    const seller = await User.create({ telegram_id: id, username: `seller_${id}` })
    const buyer = await User.create({ telegram_id: String(nextId++), username: `buyer_${id}` })
    const collection = await Collection.create({
      short_name: `refactor${id}`,
      display_name: `Refactor ${id}`,
    })
    const model = await GiftModel.create({
      fk_collection_id: collection.pk_collection_id,
      name: 'Test model',
      rarity: '15',
    })
    const background = await Background.create({
      background_id: String(nextId++),
      name: `Backdrop ${id}`,
    })
    const symbol = await GiftSymbol.create({ name: `Symbol ${id}` })
    await CollectionBackground.create({ fk_collection_id: collection.pk_collection_id, fk_background_id: background.pk_background_id })
    await CollectionSymbol.create({ fk_collection_id: collection.pk_collection_id, fk_symbol_id: symbol.pk_symbol_id })
    const gift = await Gift.create({
      telegram_gift_id: String(nextId++),
      name: `Refactor${id}-1`,
      fk_collection_id: collection.pk_collection_id,
      fk_model_id: model.pk_model_id,
      fk_background_id: background.pk_background_id,
      fk_symbol_id: symbol.pk_symbol_id,
    })
    await Ownership.create({ fk_user_id: seller.pk_user_id, fk_gift_id: gift.pk_gift_id })
    await sequelize.query('INSERT INTO gift_custody_observations(fk_gift_id, fk_custodian_user_id, is_present) VALUES (:gift, :user, true)', {
      replacements: { gift: gift.pk_gift_id, user: custodian.pk_user_id },
    })
    await WalletBalance.upsert({
      fk_user_id: buyer.pk_user_id,
      available_nano: 20e9,
      locked_nano: 0,
    })
    await WalletBalance.upsert({
      fk_user_id: seller.pk_user_id,
      available_nano: 0,
      locked_nano: 0,
    })
    const listed = await request('/gifts/list', {
      user: seller,
      body: { id: gift.public_id, price: 5 },
    })
    assert.equal(listed.status, 200, JSON.stringify(listed.data))
    assert.equal((await GiftListing.findOne({ where: { public_id: listed.data.listing.id } })).currency_code, 'GRAM')
    assert.deepEqual(Object.keys(listed.data.listing).sort(), ['id', 'price_nano'])
    const purchase = { id: gift.public_id, listing_id: listed.data.listing.id, expected_price_nano: String(listed.data.listing.price_nano) }
    // The fixture writes catalog rows directly; in production only a catalog sync does.
    invalidateFiltersCatalogCache({ catalog: true })
    return { seller, buyer, gift, collection, model, background, symbol, purchase, listingId: (await GiftListing.findOne({ where: { public_id: purchase.listing_id } })).pk_gift_listing_id }
  }
  const wallet = (user) => WalletBalance.findOne({ where: { fk_user_id: user.pk_user_id } })
  const ownership = (gift) => Ownership.findOne({ where: { fk_gift_id: gift.pk_gift_id } })
  const offerFor = (buyer, gift) =>
    Offer.findOne({
      where: { fk_buyer_user_id: buyer.pk_user_id, fk_gift_id: gift.pk_gift_id },
      order: [['pk_offer_id', 'DESC']],
    })

  await t.test('UUIDs remain stable on login and user updates; news accepts only public IDs', async () => {
    const f = await fixture()
    const publicId = f.buyer.public_id
    const { loginDevelopment } = await import('../src/modules/auth/auth.service.js')
    const { verifyToken } = await import('../src/modules/auth/auth-token.signer.js')
    const previous = process.env.ALLOW_DEV_AUTH
    process.env.ALLOW_DEV_AUTH = 'true'
    try {
      for (const username of ['renamed', 'again']) {
        const login = await loginDevelopment({ body: { id: f.buyer.telegram_id, username } })
        const token = verifyToken(login.payload.token)
        assert.equal(token.sub, publicId)
        assert.equal(token.pk_user_id, undefined)
      }
    } finally {
      if (previous === undefined) delete process.env.ALLOW_DEV_AUTH
      else process.env.ALLOW_DEV_AUTH = previous
    }
    assert.equal((await f.buyer.reload()).public_id, publicId)
    await f.seller.update({ is_admin: true })
    const created = await request('/news', { user: f.seller, body: { title: 'UUID news', content: 'News body' } })
    assert.match(created.data.news.id, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    const changed = await request(`/news/${created.data.news.id}`, { user: f.seller, body: { title: 'Changed' } })
    assert.equal(changed.data.news.id, created.data.news.id)
    assert.equal((await request('/news/1', { user: f.seller, body: { title: 'Changed' } })).status, 400)
    assert.equal((await request(`/news/${created.data.news.id}`, { user: f.seller, method: 'DELETE' })).status, 200)
    assert.equal((await request('/gifts/list', { user: f.seller, body: { id: f.gift.pk_gift_id, price: 5 } })).status, 400)
  })

  await t.test('listing and offer prices share strict decimal validation and preserve one nano', async () => {
    const f = await fixture()
    const balanceBefore = (await wallet(f.buyer)).toJSON()
    for (const amount of ['1abc', '1.0000000001', '0', '-1', '0.499999999', '100000.000000001']) {
      const listed = await request('/gifts/list', {
        user: f.seller, body: { id: f.gift.public_id, price: amount },
      })
      assert.equal(listed.status, 400, amount)
      const offered = await request('/offers', {
        user: f.buyer, body: { gift_id: f.gift.public_id, amount },
      })
      assert.equal(offered.status, 400, amount)
    }
    assert.equal(String((await GiftListing.findByPk(f.listingId)).price_nano), '5000000000')
    assert.equal(await offerFor(f.buyer, f.gift), null)
    assert.deepEqual((await wallet(f.buyer)).toJSON(), balanceBefore)

    const listed = await request('/gifts/list', {
      user: f.seller, body: { id: f.gift.public_id, price: '1,000000001' },
    })
    assert.equal(listed.status, 200)
    assert.equal(listed.data.listing.price_nano, '1000000001')
    const tooHigh = await request('/offers', {
      user: f.buyer, body: { gift_id: f.gift.public_id, amount: '1.000000002' },
    })
    assert.equal(tooHigh.status, 400)
    assert.match(tooHigh.data.error, /cannot exceed listed price/)
    const offered = await request('/offers', {
      user: f.buyer, body: { gift_id: f.gift.public_id, amount: '1,000000001' },
    })
    assert.equal(offered.status, 200)
    assert.equal(String((await offerFor(f.buyer, f.gift)).amount_nano), '1000000001')
    assert.equal(String((await wallet(f.buyer)).locked_nano), '1000000001')
  })

  await t.test('deposit conflict freezes every gift action and escrow expiry, and is visible to admins', async () => {
    const f = await fixture()
    assert.equal((await request('/offers', { user: f.buyer, body: { gift_id: f.gift.public_id, amount: 3 } })).status, 200)
    const offer = await offerFor(f.buyer, f.gift)
    await offer.update({ expires_at: new Date(Date.now() - 1000) })
    const before = (await wallet(f.buyer)).toJSON()
    const txCount = await WalletTransaction.count({ where: { fk_user_id: f.buyer.pk_user_id } })
    await sequelize.query("INSERT INTO gift_action_blocks(fk_gift_id,reason) VALUES (:gift,'DUPLICATE_REAL_DEPOSIT')", {
      replacements: { gift: f.gift.pk_gift_id },
    })
    const catalog = await request(`/search?collection_id=${f.collection.pk_collection_id}`)
    assert.deepEqual(catalog.data.gifts, [])
    const scopedFilters = await request(`/filters/catalog/collection?collection=${f.collection.short_name}`)
    assert.equal(scopedFilters.data.models.find(model => model.id === f.model.pk_model_id).on_sale_count, 0)
    const quote = await request(`/gifts/${f.gift.public_id}/quote`)
    assert.equal(quote.status, 409)
    assert.equal(quote.data.code, 'GIFT_BLOCKED')
    const actions = [
      ['/gifts/list', f.seller, { id: f.gift.public_id, price: 4 }],
      ['/gifts/buy', f.buyer, f.purchase],
      ['/gifts/cancel', f.seller, { id: f.gift.public_id }],
      ['/gifts/withdraw', f.seller, { id: f.gift.public_id, request_key: 'blocked', expected_fee_nano: '250000000' }],
      ['/offers', f.buyer, { gift_id: f.gift.public_id, amount: 2 }],
      [`/offers/${offer.public_id}/accept`, f.seller, {}],
      [`/offers/${offer.public_id}/reject`, f.seller, {}],
      [`/offers/${offer.public_id}/cancel`, f.buyer, {}],
    ]
    for (const [path, user, body] of actions) {
      const result = await request(path, { user, body })
      assert.equal(result.status, 409, path)
      assert.equal(result.data.code, 'GIFT_BLOCKED', path)
    }
    const { expireOffers } = await import('../src/modules/offers/offers-expiry.worker.js')
    await expireOffers()
    const listed = await request('/my/offers?role=outgoing', { user: f.buyer })
    assert.equal(listed.status, 200)
    await offer.reload()
    assert.equal(offer.status, 'pending')
    assert.equal(String(offer.escrow_locked_nano), '3000000000')
    assert.deepEqual((await wallet(f.buyer)).toJSON(), before)
    assert.equal(await WalletTransaction.count({ where: { fk_user_id: f.buyer.pk_user_id } }), txCount)
    assert.equal(String((await ownership(f.gift)).fk_user_id), String(f.seller.pk_user_id))
    assert.equal((await GiftListing.findByPk(f.listingId)).status, 'active')
    await f.seller.update({ is_admin: true })
    const operations = await request('/admin/operations', { user: f.seller })
    assert.equal(operations.data.gift_blocks.some(block => block.gift_id === f.gift.public_id), true)
  })

  await t.test('repeating a completed purchase succeeds without a second debit', async () => {
    const f = await fixture()
    const body = f.purchase
    const first = await request('/gifts/buy', { user: f.buyer, body })
    assert.equal(first.status, 200)
    // Ignore the first response, as a disconnected client would, and retry later.
    assert.deepEqual((await request('/gifts/buy', { user: f.buyer, body })).data, first.data)
    assert.equal(String((await wallet(f.buyer)).available_nano), '15000000000')
    // A later transaction must not be undone in the UI by an old purchase receipt.
    await (await wallet(f.buyer)).update({ available_nano: '14000000000' })
    const replay = await request('/gifts/buy', { user: f.buyer, body })
    assert.equal(replay.status, 200)
    assert.deepEqual(replay.data.wallet, { available_nano: '14000000000', locked_nano: '0', currency_code: 'GRAM' })
    assert.equal(String((await wallet(f.buyer)).available_nano), '14000000000')
    assert.equal(await WalletTransaction.count({ where: { fk_gift_id: f.gift.pk_gift_id, tx_kind: 'purchase' } }), 1)
    assert.equal(await MarketplaceFeeEntry.count({ where: { fk_gift_listing_id: f.listingId } }), 1)
    // Only the same buyer, listing and price repeat the purchase.
    const changed = await request('/gifts/buy', { user: f.buyer, body: { ...body, expected_price_nano: '1' } })
    assert.equal(changed.status, 409)
    assert.equal(changed.data.code, 'LISTING_CHANGED')
    const other = await request('/gifts/buy', { user: f.seller, body })
    assert.equal(other.status, 409)
    assert.equal(other.data.code, 'LISTING_CHANGED')
    // A listing closed by this buyer's accepted offer was not bought directly.
    await GiftListing.update({ closed_reason: 'sold_offer' }, { where: { pk_gift_listing_id: f.listingId } })
    assert.equal((await request('/gifts/buy', { user: f.buyer, body })).status, 409)
  })

  await t.test('failed purchase can be retried', async () => {
    const f = await fixture()
    // A sale journals both sides with one bulk insert.
    const original = WalletTransaction.bulkCreate
    WalletTransaction.bulkCreate = async () => { throw new Error('Injected ledger failure') }
    try {
      assert.equal((await request('/gifts/buy', { user: f.buyer, body: f.purchase })).status, 500)
    } finally { WalletTransaction.bulkCreate = original }
    assert.equal(String((await wallet(f.buyer)).available_nano), '20000000000')
    assert.equal((await request('/gifts/buy', { user: f.buyer, body: f.purchase })).status, 200)
  })

  await t.test('admin gift imports validate input, isolate requesters and replay requests', async () => {
    const f = await fixture()
    const endpoint = '/admin/gift-imports'
    const body = { username: '@ExampleUser', max_count: 20, request_key: 'import-request' }
    assert.equal((await request(endpoint, { body })).status, 401)
    assert.equal((await request(endpoint, { user: f.buyer, body })).status, 403)
    assert.equal((await request(endpoint, { user: f.buyer })).status, 403)
    await f.buyer.update({ is_admin: true })
    await f.seller.update({ is_admin: true })
    for (const invalid of [{ ...body, max_count: 0 }, { ...body, max_count: 1001 }, { ...body, max_count: 1.5 },
      { ...body, username: 'https://t.me/user' }, { ...body, username: 'me' }, { ...body, recipient: f.seller.pk_user_id }]) {
      assert.equal((await request(endpoint, { user: f.buyer, body: invalid })).status, 400)
    }
    try {
      const responses = await Promise.all([1, 2].map(() => request(endpoint, { user: f.buyer, body })))
      assert.deepEqual(responses.map(item => item.status).sort(), [200, 202])
      assert.equal(responses[0].data.job.id, responses[1].data.job.id)
      assert.equal(responses[0].data.job.username, 'exampleuser')
      assert.equal((await request(endpoint, { user: f.seller })).data.job, null)
      assert.equal((await request(endpoint, { user: f.buyer, body: { ...body, max_count: 10 } })).data.code, 'IDEMPOTENCY_CONFLICT')
      assert.equal((await request(endpoint, { user: f.buyer, body: { ...body, request_key: 'another' } })).data.code, 'IMPORT_IN_PROGRESS')
      const latest = await request(endpoint, { user: f.buyer })
      assert.equal(latest.data.job.status, 'queued')
      assert.equal(latest.data.job.id, responses[0].data.job.id)
      const [stored] = await sequelize.query('SELECT fk_admin_user_id::text AS admin FROM admin_gift_imports WHERE public_id=:id', { replacements: { id: latest.data.job.id } })
      assert.equal(stored[0].admin, String(f.buyer.pk_user_id))
    } finally {
      await sequelize.query("UPDATE admin_gift_imports SET status='failed', error_code='TEST_CLEANUP' WHERE fk_admin_user_id=:admin", { replacements: { admin: f.buyer.pk_user_id } })
    }
  })

  await t.test('administrator writes and operational metrics reject ordinary users', async () => {
    const f = await fixture()
    assert.equal((await request('/news', { user: f.buyer, body: { title: 'Admin only', content: 'Body' } })).status, 403)
    assert.equal((await request('/admin/operations', { user: f.buyer })).status, 403)
    assert.equal((await request('/ready')).status, 200)
    await f.seller.update({ is_admin: true })
    const metrics = await request('/admin/operations', { user: f.seller })
    assert.equal(metrics.status, 200)
    assert.ok(metrics.data.http.requests > 0)
  })
  await t.test('offers paginate without gaps and count pending incoming across the full feed', async () => {
    const f = await fixture()
    const rows = await Offer.bulkCreate(Array.from({ length: 5 }, (_, index) => ({
      fk_gift_id: f.gift.pk_gift_id, fk_seller_user_id: f.seller.pk_user_id,
      fk_buyer_user_id: f.buyer.pk_user_id, amount_nano: '1000000000',
      status: index === 0 ? 'pending' : 'rejected', expires_at: new Date(Date.now() + 3600000),
      created_at: new Date('2026-01-01T00:00:00Z'),
    })))
    const expected = rows.map(row => row.public_id).reverse()
    const first = await request('/my/offers?role=all&status=all&limit=2', { user: f.seller })
    assert.equal(first.status, 200)
    assert.equal(first.data.pending_incoming_count, 1)
    assert.deepEqual(first.data.offers.map(row => row.id), expected.slice(0, 2))
    // A newly inserted row must not shift the older page boundary.
    await Offer.create({ fk_gift_id: f.gift.pk_gift_id, fk_seller_user_id: f.seller.pk_user_id,
      fk_buyer_user_id: f.buyer.pk_user_id, amount_nano: '1000000000', status: 'rejected', expires_at: new Date() })
    let cursor = first.data.pagination.next_cursor
    const seen = first.data.offers.map(row => row.id)
    while (cursor) {
      const next = await request(`/my/offers?role=all&status=all&limit=2&cursor=${cursor}`, { user: f.seller })
      assert.equal(next.status, 200)
      assert.equal('pending_incoming_count' in next.data, false)
      seen.push(...next.data.offers.map(row => row.id))
      cursor = next.data.pagination.next_cursor
    }
    assert.deepEqual(seen, expected)
    const outgoing = await request('/my/offers?role=outgoing&status=pending&limit=1', { user: f.buyer })
    assert.equal(outgoing.data.offers[0].direction, 'outgoing')
    assert.equal(outgoing.data.pending_incoming_count, 0)
    assert.equal(outgoing.data.pagination.next_cursor, null)
    assert.equal((await request('/my/offers?cursor=oops', { user: f.seller })).status, 400)
    assert.equal((await request('/my/offers?cursor=0', { user: f.seller })).status, 400)
  })

  await t.test('history cursors return disjoint pages and quote endpoint exposes current price', async () => {
    const f = await fixture()
    for (let i = 0; i < 3; i++) await WalletTransaction.create({ fk_user_id: f.buyer.pk_user_id, tx_kind: 'deposit', direction: 'credit', status: 'completed', amount_nano: 1 })
    const first = await request('/my/wallet/transactions?limit=2', { user: f.buyer })
    const second = await request(`/my/wallet/transactions?limit=2&cursor=${first.data.pagination.next_cursor}`, { user: f.buyer })
    assert.equal(first.data.transactions.length, 2)
    assert.equal(second.data.transactions.length, 1)
    assert.equal(second.data.pagination.next_cursor, null)
    assert.equal(new Set([...first.data.transactions, ...second.data.transactions].map(row => row.id)).size, 3)
    assert.equal(typeof first.data.transactions[0].amount_nano, 'string')
    const quote = await request(`/gifts/${f.gift.public_id}/quote`)
    assert.equal(quote.data.quote.price_nano, f.purchase.expected_price_nano)
  })
  await t.test('ordinary gifts cannot be listed while custody is not configured', async () => {
    const f = await fixture()
    const configuredCustodian = process.env.CUSTODY_TELEGRAM_USER_ID
    try {
      delete process.env.CUSTODY_TELEGRAM_USER_ID
      await sequelize.query('DELETE FROM gift_custody_observations WHERE fk_gift_id=:gift', { replacements: { gift: f.gift.pk_gift_id } })
      const response = await request('/gifts/list', { user: f.seller, body: { id: f.gift.public_id, price: 4 } })
      assert.equal(response.status, 503)
      assert.equal(response.data.code, 'CUSTODY_NOT_CONFIGURED')
      const listing = await GiftListing.findOne({ where: { fk_gift_id: f.gift.pk_gift_id, status: 'active' } })
      assert.equal(String(listing.pk_gift_listing_id), String(f.listingId))
    } finally {
      process.env.CUSTODY_TELEGRAM_USER_ID = configuredCustodian
    }
  })
  await t.test('test imports can trade and withdraw without custody, preserving fees and releasing escrow', async () => {
    const f = await fixture()
    await f.gift.update({ is_test_import: true })
    const offered = await fixture()
    await offered.gift.update({ is_test_import: true })
    const configuredCustodian = process.env.CUSTODY_TELEGRAM_USER_ID
    try {
      delete process.env.CUSTODY_TELEGRAM_USER_ID
      const storage = await getInventory(f.seller, { listed: true })
      assert.equal(storage.data.gifts.find(gift => gift.id === f.gift.public_id).is_test_import, true)
      const forbidden = await request('/gifts/withdraw', { user: f.buyer, body: { id: f.gift.public_id } })
      assert.equal(forbidden.status, 403)
      const listed = await request('/gifts/list', { user: f.seller, body: { id: f.gift.public_id, price: 4 } })
      assert.equal(listed.status, 200)
      const bought = await request('/gifts/buy', { user: f.buyer, body: {
        id: f.gift.public_id, listing_id: listed.data.listing.id, expected_price_nano: '4000000000',
      } })
      assert.equal(bought.status, 200)
      const feesBefore = await MarketplaceFeeEntry.count()
      const withdrawn = await request('/gifts/withdraw', { user: f.buyer, body: { id: f.gift.public_id } })
      assert.equal(withdrawn.status, 200)
      assert.equal(await Gift.findByPk(f.gift.pk_gift_id), null)
      assert.equal(await MarketplaceFeeEntry.count(), feesBefore)
      assert.equal((await GiftListing.findOne({ where: { public_id: listed.data.listing.id } })).fk_gift_id, null)
      assert.equal((await request('/gifts/withdraw', { user: f.buyer, body: { id: f.gift.public_id } })).status, 404)

      const before = (await wallet(offered.buyer)).toJSON()
      assert.equal((await request('/offers', { user: offered.buyer, body: { gift_id: offered.gift.public_id, amount: 3 } })).status, 200)
      assert.equal((await request('/gifts/withdraw', { user: offered.seller, body: { id: offered.gift.public_id } })).status, 200)
      const after = await wallet(offered.buyer)
      assert.equal(String(after.available_nano), String(before.available_nano))
      assert.equal(String(after.locked_nano), String(before.locked_nano))
    } finally {
      process.env.CUSTODY_TELEGRAM_USER_ID = configuredCustodian
    }
  })
  const depositFor = async f => {
    await (await wallet(f.seller)).update({ available_nano: 1e9 })
    const [rows] = await sequelize.query(`INSERT INTO telegram_gift_deposits
      (custodian_telegram_id,message_id,chat_id,sender_telegram_id,fk_gift_id,
       owned_gift_id,received_gift_id,status,received_at)
      VALUES (:keeper,:message,:sender,:sender,:gift,:message,:message,'credited',now()) RETURNING pk_deposit_id`, {
      replacements: { keeper: custodian.telegram_id, message: String(nextId++), sender: f.seller.telegram_id, gift: f.gift.pk_gift_id },
    })
    return rows[0].pk_deposit_id
  }
  const withdraw = (f, user = f.seller, key = `withdraw-${f.gift.pk_gift_id}`) => request('/gifts/withdraw', {
    user, body: { id: f.gift.public_id, request_key: key, expected_fee_nano: '250000000' },
  })
  await t.test('real withdrawal belongs to the current buyer and replays concurrent requests', async () => {
    const f = await fixture()
    await depositFor(f)
    assert.equal((await request('/gifts/buy', { user: f.buyer, body: f.purchase })).status, 200)
    assert.equal((await withdraw(f)).status, 403)
    assert.equal((await request('/gifts/withdraw', { user: f.buyer, body: { id: f.gift.public_id } })).status, 400)
    assert.equal((await request('/gifts/withdraw', { user: f.buyer, body: {
      id: f.gift.public_id, request_key: 'forged-recipient', recipient_telegram_id: f.seller.telegram_id,
    } })).status, 400)
    const queued = await Promise.all([1, 2, 3].map(() => withdraw(f, f.buyer)))
    assert.deepEqual(queued.map(r => r.status), [202, 202, 202])
    const job = queued[0].data.job
    assert.equal(new Set(queued.map(r => r.data.job.id)).size, 1)
    // The recipient is the job owner's Telegram account.
    const [[storedJob]] = await sequelize.query(`SELECT u.telegram_id::text AS recipient_telegram_id FROM gift_withdrawals w
      JOIN users u ON u.pk_user_id = w.fk_user_id WHERE w.public_id=:id`, { replacements: { id: job.id } })
    assert.equal(storedJob.recipient_telegram_id, String(f.buyer.telegram_id))
    assert.notEqual(storedJob.recipient_telegram_id, String(f.seller.telegram_id))
    assert.deepEqual(Object.keys(job).sort(), ['available_at', 'error_code', 'fee_nano', 'id', 'status'])
    assert.equal(job.status, 'queued')
    assert.equal(job.fee_nano, '250000000')
    assert.equal(queued[0].data.wallet.available_nano, '14750000000')
    assert.equal(String((await wallet(f.buyer)).locked_nano), '250000000')
    assert.equal(String((await wallet(f.buyer)).total_nano), '15000000000')
    assert.equal(await WalletTransaction.count({ where: { fk_user_id: f.buyer.pk_user_id, tx_kind: 'gift_withdrawal_fee' } }), 1)
    assert.equal((await ownership(f.gift)).fk_user_id, f.buyer.pk_user_id)
    assert.equal((await withdraw(f, f.buyer, 'another-key')).data.job.id, job.id)
    assert.equal((await request(`/gifts/withdrawals/${job.id}`, { user: f.buyer })).data.job.id, job.id)
    assert.equal((await request(`/gifts/withdrawals/${job.id}`, { user: f.seller })).status, 404)
    assert.equal((await request(`/gifts/withdrawals/${job.id}`)).status, 401)
    for (const status of ['queued', 'sending', 'review']) {
      await sequelize.query('UPDATE gift_withdrawals SET status=:status WHERE public_id=:id', { replacements: { id: job.id, status } })
      assert.equal((await request('/gifts/list', { user: f.buyer, body: { id: f.gift.public_id, price: 1 } })).data.code, 'WITHDRAWAL_IN_PROGRESS')
      assert.equal((await request('/offers', { user: f.seller, body: { gift_id: f.gift.public_id, amount: 1 } })).data.code, 'WITHDRAWAL_IN_PROGRESS')
    }
    // Emulate the worker's confirmed completion; an HTTP retry must not send again.
    await sequelize.query("UPDATE gift_withdrawals SET status='completed',completed_at=now() WHERE public_id=:id", { replacements: { id: job.id } })
    await Ownership.destroy({ where: { fk_gift_id: f.gift.pk_gift_id } })
    const replay = await withdraw(f, f.buyer)
    assert.equal(replay.status, 200)
    assert.equal(replay.data.job.status, 'completed')
    assert.equal(String((await wallet(f.buyer)).total_nano), '14750000000')
    assert.equal(String((await wallet(f.buyer)).locked_nano), '0')
    assert.equal(await MarketplaceFeeEntry.count({ where: { fk_gift_withdrawal_id: await withdrawalKey(job.id) } }), 1)
    assert.equal(String((await MarketplaceFeeEntry.findOne({ where: { fk_gift_withdrawal_id: await withdrawalKey(job.id) } })).amount_nano), '250000000')
    const history = await request('/my/wallet/transactions', { user: f.buyer })
    const charge = history.data.transactions.find(tx => tx.tx_kind === 'gift_withdrawal_fee')
    assert.equal(charge.status, 'completed')
    assert.equal(charge.amount_nano, '250000000')
    assert.equal((await withdraw(f, f.buyer, 'new-request-after-delivery')).status, 403)
  })
  await t.test('queueing a withdrawal cancels listing and refunds offers atomically', async () => {
    const f = await fixture()
    await depositFor(f)
    assert.equal((await request('/offers', { user: f.buyer, body: { gift_id: f.gift.public_id, amount: 3 } })).status, 200)
    const response = await withdraw(f)
    assert.equal(response.status, 202, JSON.stringify(response.data))
    assert.equal((await GiftListing.findByPk(f.listingId)).status, 'canceled')
    assert.equal((await offerFor(f.buyer, f.gift)).status, 'rejected')
    assert.equal(String((await wallet(f.buyer)).available_nano), '20000000000')
    assert.equal(String((await wallet(f.buyer)).locked_nano), '0')
    assert.equal((await ownership(f.gift)).fk_user_id, f.seller.pk_user_id)
    assert.equal((await request('/gifts/buy', { user: f.buyer, body: f.purchase })).status, 409)
    await sequelize.query("UPDATE gift_withdrawals SET status='failed',error_code='INSUFFICIENT_STARS' WHERE public_id=:id", { replacements: { id: response.data.job.id } })
    const replay = await withdraw(f)
    assert.equal(replay.data.job.status, 'failed')
    assert.equal(replay.data.wallet.available_nano, '1000000000')
    assert.equal(String((await wallet(f.seller)).locked_nano), '0')
    assert.equal(String((await wallet(f.seller)).total_nano), '1000000000')
    assert.equal((await WalletTransaction.findOne({ where: { fk_gift_id: f.gift.pk_gift_id, tx_kind: 'gift_withdrawal_fee' } })).status, 'canceled')
    assert.equal(await MarketplaceFeeEntry.count({ where: { fk_gift_withdrawal_id: await withdrawalKey(response.data.job.id) } }), 0)
    const retry = await withdraw(f, f.seller, 'retry-after-funding')
    assert.equal(retry.status, 202)
    assert.notEqual(retry.data.job.id, response.data.job.id)
    await sequelize.query("UPDATE gift_withdrawals SET status='failed' WHERE public_id=:id", { replacements: { id: retry.data.job.id } })
  })
  await t.test('receipt dates never block withdrawals; only a Telegram rejection exposes the refreshed date', async () => {
    const f = await fixture()
    assert.equal((await request('/offers', { user: f.buyer, body: { gift_id: f.gift.public_id, amount: 3 } })).status, 200)
    assert.equal((await withdraw(f)).data.code, 'DEPOSIT_REQUIRED')
    assert.equal((await GiftListing.findByPk(f.listingId)).status, 'active')
    assert.equal((await offerFor(f.buyer, f.gift)).status, 'pending')
    assert.equal(String((await wallet(f.buyer)).locked_nano), '3000000000')
    const deposit = await depositFor(f)
    const date = new Date(Date.now() + 86400000).toISOString()
    await sequelize.query('UPDATE telegram_gift_deposits SET next_transfer_at=:date WHERE pk_deposit_id=:id', { replacements: { id: deposit, date } })
    const response = await withdraw(f)
    assert.equal(response.status, 202, JSON.stringify(response.data))
    assert.equal(response.data.job.status, 'queued')
    assert.equal(response.data.job.available_at, null)
    assert.equal((await GiftListing.findByPk(f.listingId)).status, 'canceled')
    assert.equal(String((await wallet(f.buyer)).locked_nano), '0')
    await sequelize.query("UPDATE gift_withdrawals SET status='failed',error_code='TRANSFER_LOCKED' WHERE public_id=:id", { replacements: { id: response.data.job.id } })
    const rejected = await request(`/gifts/withdrawals/${response.data.job.id}`, { user: f.seller })
    assert.equal(rejected.data.job.error_code, 'TRANSFER_LOCKED')
    assert.equal(rejected.data.job.available_at, date)
    await sequelize.query('UPDATE telegram_gift_deposits SET next_transfer_at=NULL WHERE pk_deposit_id=:id', { replacements: { id: deposit } })
    const refreshed = await request(`/gifts/withdrawals/${response.data.job.id}`, { user: f.seller })
    assert.equal(refreshed.data.job.available_at, null)
  })
  await t.test('fee confirmation and available funds are required before changing listing or offers', async () => {
    const f = await fixture()
    await depositFor(f)
    await request('/offers', { user: f.buyer, body: { gift_id: f.gift.public_id, amount: 3 } })
    for (const fee of [undefined, '1']) {
      const result = await request('/gifts/withdraw', { user: f.seller, body: {
        id: f.gift.public_id, request_key: 'confirm-fee', ...(fee ? { expected_fee_nano: fee } : {}),
      } })
      assert.equal(result.data.code, 'WITHDRAWAL_FEE_CHANGED')
    }
    await (await wallet(f.seller)).update({ available_nano: 249999999 })
    assert.equal((await withdraw(f)).data.code, 'INSUFFICIENT_BALANCE')
    assert.equal((await GiftListing.findByPk(f.listingId)).status, 'active')
    assert.equal((await offerFor(f.buyer, f.gift)).status, 'pending')
    assert.equal(String((await wallet(f.seller)).available_nano), '249999999')
    assert.equal(await WalletTransaction.count({ where: { fk_user_id: f.seller.pk_user_id } }), 0)
    // Exact fee is enough, and retrying the same key after funding is safe.
    await (await wallet(f.seller)).update({ available_nano: 250000000 })
    const result = await withdraw(f)
    assert.equal(result.status, 202)
    assert.equal(result.data.wallet.available_nano, '0')
    await sequelize.query("UPDATE gift_withdrawals SET status='failed' WHERE public_id=:id", { replacements: { id: result.data.job.id } })
  })
  await t.test('ledger failure rolls back fee reservation and can be retried', async () => {
    const f = await fixture()
    await depositFor(f)
    const original = WalletTransaction.create
    WalletTransaction.create = async () => { throw new Error('Injected withdrawal ledger failure') }
    try { assert.equal((await withdraw(f)).status, 500) } finally { WalletTransaction.create = original }
    assert.equal(String((await wallet(f.seller)).available_nano), '1000000000')
    assert.equal(String((await wallet(f.seller)).locked_nano), '0')
    assert.equal((await GiftListing.findByPk(f.listingId)).status, 'active')
    const result = await withdraw(f)
    assert.equal(result.status, 202)
    await assert.rejects(sequelize.query('UPDATE gift_withdrawals SET fee_nano=1 WHERE public_id=:id', { replacements: { id: result.data.job.id } }))
    await sequelize.query("UPDATE gift_withdrawals SET status='failed' WHERE public_id=:id", { replacements: { id: result.data.job.id } })
    await assert.rejects(sequelize.query("UPDATE gift_withdrawals SET status='queued' WHERE public_id=:id", { replacements: { id: result.data.job.id } }))
  })
  await t.test('concurrent withdrawals for different gifts cannot overspend the same wallet', async () => {
    const first = await fixture()
    const second = await fixture()
    await depositFor(first)
    await depositFor(second)
    await Ownership.update({ fk_user_id: first.seller.pk_user_id }, { where: { fk_gift_id: second.gift.pk_gift_id } })
    await (await wallet(first.seller)).update({ available_nano: 250000000 })
    const results = await Promise.all([withdraw(first), withdraw(second, first.seller)])
    assert.deepEqual(results.map(r => r.status).sort(), [202, 409])
    assert.equal(results.find(r => r.status === 409).data.code, 'INSUFFICIENT_BALANCE')
    assert.equal(String((await wallet(first.seller)).locked_nano), '250000000')
    assert.equal(String((await wallet(first.seller)).available_nano), '0')
    const job = results.find(r => r.status === 202).data.job
    await sequelize.query("UPDATE gift_withdrawals SET status='failed' WHERE public_id=:id", { replacements: { id: job.id } })
  })
  await t.test('sale and withdrawal racing cannot both succeed', async () => {
    const f = await fixture()
    await depositFor(f)
    const [withdrawal, sale] = await Promise.all([
      withdraw(f), request('/gifts/buy', { user: f.buyer, body: f.purchase }),
    ])
    if (withdrawal.status === 202) {
      assert.equal(sale.status, 409)
      assert.equal((await ownership(f.gift)).fk_user_id, f.seller.pk_user_id)
      await sequelize.query("UPDATE gift_withdrawals SET status='failed' WHERE public_id=:id", { replacements: { id: withdrawal.data.job.id } })
    } else {
      assert.equal(withdrawal.status, 403)
      assert.equal(sale.status, 200)
      assert.equal((await ownership(f.gift)).fk_user_id, f.buyer.pk_user_id)
    }
  })
  await t.test('missing, stale and wrong-custodian gifts cannot be traded', async () => {
    const f = await fixture()
    const listingBefore = (await GiftListing.findOne({ where: { fk_gift_id: f.gift.pk_gift_id } })).toJSON()
    const configuredCustodian = process.env.CUSTODY_TELEGRAM_USER_ID
    try {
      delete process.env.CUSTODY_TELEGRAM_USER_ID
      const response = await request('/gifts/buy', { user: f.buyer, body: f.purchase })
      assert.equal(response.status, 503)
      assert.equal(response.data.code, 'CUSTODY_NOT_CONFIGURED')
      assert.deepEqual((await GiftListing.findOne({ where: { fk_gift_id: f.gift.pk_gift_id } })).toJSON(), listingBefore)
    } finally {
      process.env.CUSTODY_TELEGRAM_USER_ID = configuredCustodian
    }
    await request('/offers', { user: f.buyer, body: { gift_id: f.gift.public_id, amount: 3 } })
    const offer = await offerFor(f.buyer, f.gift)
    const before = (await wallet(f.buyer)).toJSON()
    await sequelize.query('UPDATE gift_custody_observations SET is_present=false WHERE fk_gift_id=:gift', { replacements: { gift: f.gift.pk_gift_id } })
    for (const [path, user, body] of [
      ['/gifts/buy', f.buyer, f.purchase],
      ['/offers', f.buyer, { gift_id: f.gift.public_id, amount: 2 }],
      [`/offers/${offer.public_id}/accept`, f.seller, undefined],
    ]) {
      const response = await request(path, { user, body, method: 'POST' })
      assert.equal(response.status, 409)
      assert.equal(response.data.code, 'GIFT_UNAVAILABLE')
    }
    assert.deepEqual((await wallet(f.buyer)).toJSON(), before)
    assert.equal(String((await ownership(f.gift)).fk_user_id), String(f.seller.pk_user_id))
    await sequelize.query('UPDATE gift_custody_observations SET is_present=true WHERE fk_gift_id=:gift', { replacements: { gift: f.gift.pk_gift_id } })
    process.env.CUSTODY_TELEGRAM_USER_ID = String(f.seller.telegram_id)
    assert.equal((await request('/gifts/buy', { user: f.buyer, body: f.purchase })).status, 409)
    process.env.CUSTODY_TELEGRAM_USER_ID = String(custodian.telegram_id)
    await sequelize.query("UPDATE gift_custody_snapshots SET completed_at=now()-interval '3 hours' WHERE fk_user_id=:user", { replacements: { user: custodian.pk_user_id } })
    assert.equal((await request('/gifts/buy', { user: f.buyer, body: f.purchase })).status, 409)
    await sequelize.query('UPDATE gift_custody_snapshots SET completed_at=now() WHERE fk_user_id=:user', { replacements: { user: custodian.pk_user_id } })
    assert.equal((await request('/gifts/buy', { user: f.buyer, body: f.purchase })).status, 200)
  })
  await t.test('a received gift can trade before the first inventory snapshot, but stale receipts cannot', async () => {
    const f = await fixture()
    await sequelize.query('DELETE FROM gift_custody_snapshots WHERE fk_user_id=:user', {
      replacements: { user: custodian.pk_user_id },
    })
    try {
      assert.equal((await request('/gifts/buy', { user: f.buyer, body: f.purchase })).status, 409)
      await sequelize.query("UPDATE gift_custody_observations SET confirmed_at=now()-interval '3 hours' WHERE fk_gift_id=:gift", {
        replacements: { gift: f.gift.pk_gift_id },
      })
      assert.equal((await request('/gifts/buy', { user: f.buyer, body: f.purchase })).status, 409)
      await sequelize.query('UPDATE gift_custody_observations SET confirmed_at=now() WHERE fk_gift_id=:gift', {
        replacements: { gift: f.gift.pk_gift_id },
      })
      assert.equal((await request('/gifts/buy', { user: f.buyer, body: f.purchase })).status, 200)
      assert.equal(String((await ownership(f.gift)).fk_user_id), String(f.buyer.pk_user_id))
    } finally {
      await sequelize.query('INSERT INTO gift_custody_snapshots(fk_user_id, completed_run) VALUES (:user, 1)', {
        replacements: { user: custodian.pk_user_id },
      })
    }
  })
  await t.test('sales cursors preserve microseconds, ties and timezone-independent pages', async () => {
    const f = await fixture()
    const ids = []
    for (const fraction of ['123900', '123800', '123800', '123700']) {
      const listing = await GiftListing.create({ fk_gift_id: f.gift.pk_gift_id,
        fk_seller_user_id: f.seller.pk_user_id, fk_buyer_user_id: f.buyer.pk_user_id,
        price_nano: '1000000000', status: 'sold', closed_reason: 'sold_direct', currency_code: 'GRAM' })
      await sequelize.query('UPDATE gift_listings SET closed_at = CAST(:date AS timestamp) WHERE pk_gift_listing_id = :id', {
        replacements: { date: `2026-01-01 12:00:00.${fraction}`, id: listing.pk_gift_listing_id },
      })
      ids.push(listing.public_id)
    }
    let cursor = ''
    const seen = []
    do {
      const response = await request(`/market/sales-history?collection_id=${f.collection.pk_collection_id}&limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`)
      assert.equal(response.status, 200)
      seen.push(...response.data.items.map(item => item.id))
      cursor = response.data.pagination.next_cursor
      if (cursor) assert.match(JSON.parse(Buffer.from(cursor, 'base64url')).value, /^2026-01-01 12:00:00\.123[789]$/)
      assert.ok(seen.length <= 4, 'Pagination must terminate')
    } while (cursor)
    assert.deepEqual(seen, [ids[0], ids[2], ids[1], ids[3]])
    const invalid = Buffer.from(JSON.stringify({ id: ids[0], closed_at: '2026-02-30 00:00:00.123456' })).toString('base64url')
    assert.equal((await request(`/market/sales-history?cursor=${invalid}`)).status, 400)
  })
  await t.test('sales history sorts by price across pages', async () => {
    const f = await fixture()
    await f.gift.update({ name: 'Crystal-Fox-00123' })
    const listings = []
    for (const [index, price] of [3, 1, 2].entries()) {
      const listing = await GiftListing.create({
        fk_gift_id: f.gift.pk_gift_id,
        fk_seller_user_id: f.seller.pk_user_id,
        fk_buyer_user_id: f.buyer.pk_user_id,
        price_nano: String(price * 1e9),
        status: 'sold',
        closed_reason: 'sold_direct',
        currency_code: 'GRAM',
      })
      await sequelize.query('UPDATE gift_listings SET closed_at = CAST(:date AS timestamp) WHERE pk_gift_listing_id = :id', {
        replacements: { date: `2026-01-0${index + 1} 12:00:00`, id: listing.pk_gift_listing_id },
      })
      listings.push(listing.public_id)
    }
    const scope = `collection_id=${f.collection.pk_collection_id}`
    const first = await request(`/market/sales-history?${scope}&sort=priceAsc&limit=2`)
    assert.equal(first.status, 200)
    assert.deepEqual(first.data.items.map(item => item.id), [listings[1], listings[2]])
    for (const item of first.data.items) {
      assert.equal(item.gift.title, 'Crystal-Fox')
      assert.equal(item.gift.number, '00123')
      assert.equal(item.gift.image, 'https://nft.fragment.com/gift/crystalfox-00123.medium.jpg')
    }
    assert.ok(first.data.pagination.next_cursor)
    const second = await request(`/market/sales-history?${scope}&sort=priceAsc&limit=2&cursor=${encodeURIComponent(first.data.pagination.next_cursor)}`)
    assert.deepEqual(second.data.items.map(item => item.id), [listings[0]])
    const descending = await request(`/market/sales-history?${scope}&sort=priceDesc`)
    assert.deepEqual(descending.data.items.map(item => item.id), [listings[0], listings[2], listings[1]])
    const newest = await request(`/market/sales-history?${scope}&limit=1`)
    assert.equal((await request(`/market/sales-history?${scope}&sort=priceAsc&cursor=${encodeURIComponent(newest.data.pagination.next_cursor)}`)).status, 400)
  })
  await t.test('expiry worker releases an unattended reservation once', async () => {
    const f = await fixture()
    await request('/offers', { user: f.buyer, body: { gift_id: f.gift.public_id, amount: '1' } })
    const offer = await offerFor(f.buyer, f.gift)
    await offer.update({ expires_at: new Date(Date.now() - 60000) })
    const listed = await request('/my/offers?role=outgoing', { user: f.buyer })
    assert.equal(listed.status, 200)
    assert.equal((await offer.reload()).status, 'pending', 'Reading the list must not write expiry or escrow')
    assert.equal(String((await wallet(f.buyer)).locked_nano), '1000000000')
    const { expireOffers } = await import('../src/modules/offers/offers-expiry.worker.js')
    await expireOffers()
    await expireOffers()
    assert.equal((await offer.reload()).status, 'expired')
    assert.equal(String((await wallet(f.buyer)).locked_nano), '0')
    assert.equal(await WalletTransaction.count({ where: { fk_user_id: f.buyer.pk_user_id, tx_kind: 'offer_escrow_release' } }), 1)
  })
  await t.test('accepting or rejecting an overdue offer commits its expiry and reports a conflict', async () => {
    for (const action of ['accept', 'reject']) {
      const f = await fixture()
      await request('/offers', { user: f.buyer, body: { gift_id: f.gift.public_id, amount: '1' } })
      const offer = await offerFor(f.buyer, f.gift)
      await offer.update({ expires_at: new Date(Date.now() - 60000) })
      const response = await request(`/offers/${offer.public_id}/${action}`, { user: f.seller, body: {} })
      assert.equal(response.status, 409)
      assert.equal(response.data.code, 'OFFER_EXPIRED')
      assert.equal((await offer.reload()).status, 'expired')
      assert.equal(String((await wallet(f.buyer)).locked_nano), '0')
    }
  })
  await t.test('seller overflow rolls back the whole purchase', async () => {
    const f = await fixture()
    await (await wallet(f.seller)).update({ available_nano: String(Number.MAX_SAFE_INTEGER) })
    const before = String((await wallet(f.buyer)).available_nano)
    const result = await request('/gifts/buy', { user: f.buyer, body: f.purchase })
    assert.notEqual(result.status, 200)
    assert.equal(String((await wallet(f.buyer)).available_nano), before)
    assert.equal(String((await ownership(f.gift)).fk_user_id), String(f.seller.pk_user_id))
  })
  await t.test('health and auth enforce disabled development login', async () => {
    assert.deepEqual(await request('/health'), {
      status: 200,
      data: { ok: true, service: 'backend' },
    })
    assert.equal((await request('/my/wallet')).status, 401)
    assert.equal((await request('/my/inventory', { method: 'POST' })).status, 405)
    const login = await request('/dev/auth/login', {
      body: { id: String(nextId++), first_name: 'Tester' },
    })
    assert.equal(login.status, 404)
  })
  await t.test(
    'catalog search, collection filters and inventory retain their payloads',
    async () => {
      const f = await fixture()
      const result = await request(`/search?collection=${f.collection.short_name}&limit=1`, {
        user: f.seller,
      })
      assert.equal(result.status, 200, JSON.stringify(result.data))
      assert.equal(result.data.gifts.length, 1)
      assert.equal(result.data.gifts[0].is_owned_by_current_user, true)
      assert.equal(result.data.pagination.limit, 1)
      const filters = await request(
        `/filters/catalog/collection?collection=${f.collection.short_name}`
      )
      assert.equal(filters.status, 200)
      assert.equal(filters.data.models.length, 1)
      const storage = await getInventory(f.seller, { listed: true, limit: 1 })
      assert.equal(storage.data.gifts.length, 1)
      assert.equal(storage.data.gifts[0].id, f.gift.public_id)
    }
  )
  await t.test('public reads revalidate by ETag and viewer-specific search is never stored', async () => {
    const f = await fixture()
    const filters = await fetch(base + '/filters/catalog')
    assert.equal(filters.headers.get('cache-control'), 'public, no-cache')
    const etag = filters.headers.get('etag')
    assert.match(etag, /^"[\w-]+"$/)
    // As a browser revalidates; fetch() would add Cache-Control: no-cache and force a reload.
    const revalidated = await fetch(base + '/filters/catalog', { headers: { 'If-None-Match': etag, 'Cache-Control': 'max-age=0' } })
    assert.equal(revalidated.status, 304)
    assert.equal(await revalidated.text(), '')
    const anonymous = await fetch(base + '/search?limit=1')
    assert.equal(anonymous.headers.get('cache-control'), 'public, max-age=5')
    assert.match(anonymous.headers.get('vary'), /Authorization/)
    const token = signToken({ sub: f.seller.public_id, ver: 0, exp: Math.floor(Date.now() / 1000) + 600 })
    const signedIn = await fetch(base + '/search?limit=1', { headers: { Authorization: `Bearer ${token}` } })
    assert.equal(signedIn.status, 200)
    assert.equal(signedIn.headers.get('cache-control'), 'no-store')
    assert.equal(signedIn.headers.get('etag'), null)
    assert.equal((await fetch(base + '/my/wallet/balance', { headers: { Authorization: `Bearer ${token}` } })).headers.get('cache-control'), 'no-store')
  })
  await t.test('profile aggregates completed trades without counting escrow operations', async () => {
    const f = await fixture()
    await request('/offers', { user: f.buyer, body: { gift_id: f.gift.public_id, amount: 3 } })
    const bought = await request('/gifts/buy', { user: f.buyer, body: f.purchase })
    assert.equal(bought.status, 200)
    const buyer = await request('/my/profile', { user: f.buyer })
    const seller = await request('/my/profile', { user: f.seller })
    assert.deepEqual(buyer.data.profile.stats, { gifts: 1, sales: 0, buys: 1 })
    assert.deepEqual(seller.data.profile.stats, { gifts: 0, sales: 1, buys: 0 })
  })
  await t.test('filter counts share an aggregate and refresh after a listing mutation', async () => {
    const f = await fixture()
    const { loadOnSaleCounts, loadCollectionFiltersPayload } = await import('../src/modules/catalog/filters/filters.service.js')
    const counts = await loadOnSaleCounts(f.collection.pk_collection_id)
    assert.equal(counts.model.get(f.model.pk_model_id), 1)
    assert.equal(counts.background.get(f.background.pk_background_id), 1)
    assert.equal(counts.symbol.get(f.symbol.pk_symbol_id), 1)
    const global = await loadOnSaleCounts()
    assert.equal(global.collection.get(f.collection.short_name), 1)
    const first = await loadCollectionFiltersPayload(f.collection.short_name)
    assert.equal(first.models.find(model => model.id === f.model.pk_model_id).on_sale_count, 1)
    await request('/gifts/cancel', { user: f.seller, body: { id: f.gift.public_id } })
    const second = await loadCollectionFiltersPayload(f.collection.short_name)
    assert.equal(second.models.find(model => model.id === f.model.pk_model_id).on_sale_count, 0)
  })
  await t.test('filter counts follow the selections of the other filter groups', async () => {
    const f = await fixture()
    const model = await GiftModel.create({ fk_collection_id: f.collection.pk_collection_id, name: 'Other model', rarity: '5' })
    const background = await Background.create({ background_id: String(nextId++), name: `Other backdrop ${nextId}` })
    await CollectionBackground.create({ fk_collection_id: f.collection.pk_collection_id, fk_background_id: background.pk_background_id })
    const other = await Gift.create({
      telegram_gift_id: String(nextId++), name: `${f.collection.short_name}-2`,
      fk_collection_id: f.collection.pk_collection_id, fk_model_id: model.pk_model_id,
      fk_background_id: background.pk_background_id, fk_symbol_id: f.symbol.pk_symbol_id,
    })
    await Ownership.create({ fk_user_id: f.seller.pk_user_id, fk_gift_id: other.pk_gift_id })
    await observe(other)
    assert.equal((await request('/gifts/list', { user: f.seller, body: { id: other.public_id, price: 7 } })).status, 200)
    const counts = async (query) => {
      const response = await request(`/filters/counts?collection_id=${f.collection.pk_collection_id}&${query}`)
      assert.equal(response.status, 200, JSON.stringify(response.data))
      return response.data.counts
    }

    const byModel = await counts(`model_id=${f.model.pk_model_id}`)
    assert.deepEqual(byModel.background, { [f.background.pk_background_id]: 1 })
    assert.deepEqual(byModel.symbol, { [f.symbol.pk_symbol_id]: 1 })
    // A group's own selection does not narrow its options.
    assert.deepEqual(byModel.model, { [f.model.pk_model_id]: 1, [model.pk_model_id]: 1 })
    assert.deepEqual(byModel.collection, { [f.collection.pk_collection_id]: 1 })
    const byBackground = await counts(`background_id=${background.pk_background_id}`)
    assert.deepEqual(byBackground.model, { [model.pk_model_id]: 1 })
    assert.deepEqual((await counts('price_max=6')).background, { [f.background.pk_background_id]: 1 })
    await request('/gifts/cancel', { user: f.seller, body: { id: other.public_id } })
    assert.deepEqual((await counts(`background_id=${background.pk_background_id}`)).model, {})
  })
  await t.test('inventory counts cover both sections, all pages and only the current owner', async () => {
    const f = await fixture()
    const stored = await Gift.create({
      telegram_gift_id: String(nextId++), name: `${f.collection.short_name}-2`,
      fk_collection_id: f.collection.pk_collection_id,
      fk_model_id: f.gift.fk_model_id,
      fk_background_id: f.gift.fk_background_id,
      fk_symbol_id: f.gift.fk_symbol_id,
    })
    await Ownership.create({ fk_user_id: f.seller.pk_user_id, fk_gift_id: stored.pk_gift_id })
    await observe(stored)
    const load = (user, extra = {}) => getInventory(user, { listed: true, limit: 1, ...extra })
    const first = await load(f.seller)
    const summary = first.data.inventory_summary
    const combination = {
      collection: f.collection.display_name, model: f.model.name, background: f.background.name, symbol: f.symbol.name,
    }
    assert.equal(summary.on_sale.total, 1)
    assert.equal(summary.not_on_sale.total, 1)
    assert.deepEqual(summary.on_sale.combinations, [{ ...combination, quantity: 1 }])
    assert.deepEqual(summary.not_on_sale.combinations, [{ ...combination, quantity: 1 }])
    const noMatches = await load(f.seller, { q: 'does-not-exist' })
    assert.equal(noMatches.data.gifts.length, 0)
    assert.deepEqual(noMatches.data.inventory_summary, summary)
    // A client that holds the summary skips it when only the filters change.
    const kept = await load(f.seller, { q: 'does-not-exist', summary: false })
    assert.equal(Object.hasOwn(kept.data, 'inventory_summary'), false)
    const empty = await load(f.buyer)
    assert.equal(empty.data.inventory_summary.on_sale.total, 0)
    assert.equal(empty.data.inventory_summary.not_on_sale.total, 0)

    await request('/gifts/list', { user: f.seller, body: { id: stored.public_id, price: 2 } })
    const listed = await load(f.seller)
    assert.equal(listed.data.gifts.length, 1)
    assert.equal(listed.data.pagination.has_more, true)
    assert.equal(listed.data.inventory_summary.on_sale.total, 2)
    assert.deepEqual(listed.data.inventory_summary.on_sale.combinations, [{ ...combination, quantity: 2 }])
    assert.equal(listed.data.inventory_summary.not_on_sale.total, 0)
    const next = await load(f.seller, { cursor: listed.data.pagination.next_cursor })
    assert.equal(next.data.gifts.length, 1)
    assert.equal(Object.hasOwn(next.data, 'inventory_summary'), false)
    await request('/gifts/cancel', { user: f.seller, body: { id: stored.public_id } })
    assert.deepEqual((await load(f.seller)).data.inventory_summary, summary)
  })
  await t.test('concurrent duplicate purchases debit and transfer exactly once', async () => {
    const f = await fixture()
    const results = await Promise.all(
      [1, 2].map(() => request('/gifts/buy', { user: f.buyer, body: f.purchase }))
    )
    // The second request waits for the first and repeats its result.
    assert.deepEqual(results.map((r) => r.status), [200, 200], JSON.stringify(results))
    assert.deepEqual(results[0].data, results[1].data)
    const fees = await MarketplaceFeeEntry.findAll({ where: { fk_gift_listing_id: f.listingId } })
    assert.equal(fees.length, 1)
    assert.equal(fees[0].amount_nano, String(calculateMarketplaceFeeNano(5e9)))
    assert.equal(Number((await wallet(f.buyer)).available_nano), 15e9)
    assert.equal(
      Number((await wallet(f.seller)).available_nano),
      5e9 - calculateMarketplaceFeeNano(5e9)
    )
    assert.equal(String((await ownership(f.gift)).fk_user_id), String(f.buyer.pk_user_id))
    assert.equal(
      await GiftListing.count({ where: { fk_gift_id: f.gift.pk_gift_id, status: 'active' } }),
      0
    )
    const history = await request('/market/sales-history?limit=1')
    assert.equal(history.status, 200)
    assert.equal(history.data.items.length, 1)
  })
  await t.test('a failed ledger write rolls back ownership, balances and listing', async () => {
    const f = await fixture()
    const originalBulkCreate = WalletTransaction.bulkCreate
    WalletTransaction.bulkCreate = async () => {
      throw new Error('Simulated ledger failure')
    }
    let result
    try {
      result = await request('/gifts/buy', { user: f.buyer, body: f.purchase })
    } finally {
      WalletTransaction.bulkCreate = originalBulkCreate
    }
    assert.equal(result.status, 500)
    assert.equal(await MarketplaceFeeEntry.count({ where: { fk_gift_listing_id: f.listingId } }), 0)
    assert.equal(Number((await wallet(f.buyer)).total_nano), 20e9)
    assert.equal(Number((await wallet(f.seller)).total_nano), 0)
    assert.equal(String((await ownership(f.gift)).fk_user_id), String(f.seller.pk_user_id))
    assert.equal(
      await GiftListing.count({ where: { fk_gift_id: f.gift.pk_gift_id, status: 'active' } }),
      1
    )
  })
  await t.test('failed purchase rolls back every offer release, balance and ledger entry', async () => {
    const f = await fixture()
    const other = await User.create({ telegram_id: String(nextId++) })
    await WalletBalance.upsert({ fk_user_id: other.pk_user_id, available_nano: 10e9, locked_nano: 0 })
    await (await wallet(f.buyer)).update({ available_nano: 4e9 })
    for (const buyer of [f.buyer, other]) {
      assert.equal((await request('/offers', { user: buyer, body: { gift_id: f.gift.public_id, amount: 3 } })).status, 200)
    }
    const before = await Offer.findAll({ where: { fk_gift_id: f.gift.pk_gift_id }, order: [['pk_offer_id', 'ASC']], raw: true })
    const ledgerCount = await WalletTransaction.count({ where: { fk_gift_id: f.gift.pk_gift_id } })
    const result = await request('/gifts/buy', { user: f.buyer, body: f.purchase })
    assert.equal(result.status, 400, JSON.stringify(result))
    assert.equal(result.data.code, 'INSUFFICIENT_BALANCE')
    assert.deepEqual(await Offer.findAll({ where: { fk_gift_id: f.gift.pk_gift_id }, order: [['pk_offer_id', 'ASC']], raw: true }), before)
    assert.equal(Number((await wallet(f.buyer)).available_nano), 1e9)
    assert.equal(Number((await wallet(other)).available_nano), 7e9)
    for (const buyer of [f.buyer, other]) assert.equal(Number((await wallet(buyer)).locked_nano), 3e9)
    assert.equal(await WalletTransaction.count({ where: { fk_gift_id: f.gift.pk_gift_id } }), ledgerCount)
    assert.equal(String((await ownership(f.gift)).fk_user_id), String(f.seller.pk_user_id))
  })
  await t.test('missing and stale quotes cannot debit; a refreshed quote succeeds', async () => {
    const f = await fixture()
    assert.equal((await request('/gifts/buy', { user: f.buyer, body: { id: f.gift.public_id } })).status, 400)
    await request('/gifts/list', { user: f.seller, body: { id: f.gift.public_id, price: 6 } })
    let result = await request('/gifts/buy', { user: f.buyer, body: f.purchase })
    assert.equal(result.status, 409)
    assert.equal(result.data.code, 'LISTING_CHANGED')
    await request('/gifts/cancel', { user: f.seller, body: { id: f.gift.public_id } })
    await request('/gifts/list', { user: f.seller, body: { id: f.gift.public_id, price: 5 } })
    result = await request('/gifts/buy', { user: f.buyer, body: f.purchase })
    assert.equal(result.status, 409)
    assert.equal(result.data.code, 'LISTING_CHANGED')
    assert.equal(Number((await wallet(f.buyer)).total_nano), 20e9)
    const listing = await GiftListing.findOne({ where: { fk_gift_id: f.gift.pk_gift_id, status: 'active' } })
    result = await request('/gifts/buy', { user: f.buyer, body: { ...f.purchase, listing_id: listing.public_id } })
    assert.equal(result.status, 200, JSON.stringify(result))
  })
  await t.test('purchase and offer acceptance settle exactly one sale', async () => {
    const f = await fixture()
    await request('/offers', { user: f.buyer, body: { gift_id: f.gift.public_id, amount: 3 } })
    const offer = await offerFor(f.buyer, f.gift)
    const results = await Promise.all([
      request('/gifts/buy', { user: f.buyer, body: f.purchase }),
      request(`/offers/${offer.public_id}/accept`, { user: f.seller, method: 'POST' }),
    ])
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409], JSON.stringify(results))
    await offer.reload()
    const amount = offer.status === 'accepted' ? 3e9 : 5e9
    assert.equal(Number((await wallet(f.buyer)).total_nano), 20e9 - amount)
    assert.equal(Number((await wallet(f.buyer)).locked_nano), 0)
    assert.equal(Number((await wallet(f.seller)).total_nano), amount - calculateMarketplaceFeeNano(amount))
    assert.equal(String((await ownership(f.gift)).fk_user_id), String(f.buyer.pk_user_id))
    assert.equal(await GiftListing.count({ where: { fk_gift_id: f.gift.pk_gift_id, status: 'sold' } }), 1)
  })
  await t.test('concurrent offer creation and purchase leave no reservation for the old owner', async () => {
    const f = await fixture()
    const results = await Promise.all([
      request('/offers', { user: f.buyer, body: { gift_id: f.gift.public_id, amount: 3 } }),
      request('/gifts/buy', { user: f.buyer, body: f.purchase }),
    ])
    assert.equal(results[1].status, 200, JSON.stringify(results))
    assert.ok([200, 400].includes(results[0].status), JSON.stringify(results))
    assert.equal(await Offer.count({ where: { fk_gift_id: f.gift.pk_gift_id, status: 'pending' } }), 0)
    assert.equal(Number((await wallet(f.buyer)).locked_nano), 0)
    assert.equal(Number((await wallet(f.buyer)).total_nano), 15e9)
  })
  await t.test('price change racing purchase never charges an unconfirmed price', async () => {
    const f = await fixture()
    const results = await Promise.all([
      request('/gifts/list', { user: f.seller, body: { id: f.gift.public_id, price: 6 } }),
      request('/gifts/buy', { user: f.buyer, body: f.purchase }),
    ])
    if (results[1].status === 200) {
      assert.equal(results[0].status, 403)
      assert.equal(Number((await wallet(f.buyer)).total_nano), 15e9)
    } else {
      assert.equal(results[0].status, 200)
      assert.equal(results[1].status, 409, JSON.stringify(results))
      assert.equal(Number((await wallet(f.buyer)).total_nano), 20e9)
    }
  })
  await t.test('opposite trades lock shared wallets in a consistent order', async () => {
    const f = await fixture()
    await (await wallet(f.seller)).update({ available_nano: 20e9 })
    const gift = await Gift.create({
      telegram_gift_id: String(nextId++), name: 'Opposite-2', fk_collection_id: f.collection.pk_collection_id,
      fk_model_id: f.gift.fk_model_id, fk_background_id: f.gift.fk_background_id, fk_symbol_id: f.gift.fk_symbol_id,
    })
    await Ownership.create({ fk_user_id: f.buyer.pk_user_id, fk_gift_id: gift.pk_gift_id })
    await observe(gift)
    const listed = await request('/gifts/list', { user: f.buyer, body: { id: gift.public_id, price: 5 } })
    assert.equal(listed.status, 200)
    // Each buyer also has a pending offer to release during settlement.
    for (const [user, giftId] of [[f.buyer, f.gift.public_id], [f.seller, gift.public_id]]) {
      assert.equal((await request('/offers', { user, body: { gift_id: giftId, amount: 3 } })).status, 200)
    }
    const results = await Promise.all([
      request('/gifts/buy', { user: f.buyer, body: f.purchase }),
      request('/gifts/buy', { user: f.seller, body: { id: gift.public_id, listing_id: listed.data.listing.id, expected_price_nano: '5000000000' } }),
    ])
    assert.ok(results.every((r) => r.status === 200), JSON.stringify(results))
    for (const user of [f.buyer, f.seller]) {
      assert.equal(Number((await wallet(user)).total_nano), 20e9 - calculateMarketplaceFeeNano(5e9))
      assert.equal(Number((await wallet(user)).locked_nano), 0)
    }
  })
  await t.test('offer cancellation racing acceptance releases or consumes escrow exactly once', async () => {
    const f = await fixture()
    await request('/offers', { user: f.buyer, body: { gift_id: f.gift.public_id, amount: 3 } })
    const offer = await offerFor(f.buyer, f.gift)
    const results = await Promise.all([
      request(`/offers/${offer.public_id}/accept`, { user: f.seller, method: 'POST' }),
      request(`/offers/${offer.public_id}/cancel`, { user: f.buyer, method: 'POST' }),
    ])
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409], JSON.stringify(results))
    await offer.reload()
    assert.equal(Number((await wallet(f.buyer)).locked_nano), 0)
    assert.equal(Number((await wallet(f.buyer)).total_nano), offer.status === 'accepted' ? 17e9 : 20e9)
  })
  await t.test('concurrent replacement offers reserve only the final amount', async () => {
    const f = await fixture()
    const results = await Promise.all([2, 3].map((amount) => request('/offers', {
      user: f.buyer, body: { gift_id: f.gift.public_id, amount },
    })))
    assert.ok(results.every((r) => r.status === 200), JSON.stringify(results))
    const pending = await Offer.findAll({ where: { fk_gift_id: f.gift.pk_gift_id, status: 'pending' } })
    assert.equal(pending.length, 1)
    assert.equal(String((await wallet(f.buyer)).locked_nano), String(pending[0].amount_nano))
    assert.equal(Number((await wallet(f.buyer)).total_nano), 20e9)
  })
  await t.test('new purchases and accepted offers do not wait for the legacy marketplace account', async () => {
    const direct = await fixture()
    const accepted = await fixture()
    await request('/offers', { user: accepted.buyer, body: { gift_id: accepted.gift.public_id, amount: 3 } })
    const offer = await offerFor(accepted.buyer, accepted.gift)
    const [marketplace] = await User.findOrCreate({ where: { telegram_id: '900000000001' } })
    const [oldWallet] = await WalletBalance.findOrCreate({
      where: { fk_user_id: marketplace.pk_user_id },
      defaults: { available_nano: '12345', locked_nano: '0'},
    })
    const before = oldWallet.toJSON()
    const oldFeeCount = await WalletTransaction.count({ where: { tx_kind: 'marketplace_fee' } })
    const blocker = await sequelize.transaction()
    try {
      // This is deterministic: the old implementation cannot finish either trade until rollback below.
      await oldWallet.reload({ transaction: blocker, lock: blocker.LOCK.UPDATE })
      await marketplace.reload({ transaction: blocker, lock: blocker.LOCK.UPDATE })
      const results = await Promise.all([
        request('/gifts/buy', { user: direct.buyer, body: direct.purchase }),
        request(`/offers/${offer.public_id}/accept`, { user: accepted.seller, method: 'POST' }),
      ])
      assert.ok(results.every((r) => r.status === 200), JSON.stringify(results))
    } finally { await blocker.rollback() }
    assert.deepEqual((await oldWallet.reload()).toJSON(), before)
    assert.equal(await WalletTransaction.count({ where: { tx_kind: 'marketplace_fee' } }), oldFeeCount)
    assert.equal((await MarketplaceFeeEntry.findOne({ where: { fk_offer_id: offer.pk_offer_id } })).amount_nano,
      String(calculateMarketplaceFeeNano(3e9)))
    assert.equal((await request(`/offers/${offer.public_id}/accept`, { user: accepted.seller, method: 'POST' })).status, 409)
    assert.equal(await MarketplaceFeeEntry.count({ where: { fk_offer_id: offer.pk_offer_id } }), 1)
  })
  await t.test('accepted offer on an unlisted gift still has a unique fee source', async () => {
    const f = await fixture()
    await request('/gifts/cancel', { user: f.seller, body: { id: f.gift.public_id } })
    await request('/offers', { user: f.buyer, body: { gift_id: f.gift.public_id, amount: 3 } })
    const offer = await offerFor(f.buyer, f.gift)
    const result = await request(`/offers/${offer.public_id}/accept`, { user: f.seller, method: 'POST' })
    assert.equal(result.status, 200, JSON.stringify(result))
    const fee = await MarketplaceFeeEntry.findOne({ where: { fk_offer_id: offer.pk_offer_id } })
    assert.equal(fee.amount_nano, String(calculateMarketplaceFeeNano(3e9)))
      assert.equal(fee.fk_gift_listing_id, null)
      const history = await request(`/market/sales-history?collection_id=${f.collection.pk_collection_id}`)
      assert.equal(history.status, 200)
      assert.equal(history.data.items.length, 1)
      const sale = history.data.items[0]
      assert.equal(sale.gift_id, f.gift.public_id)
      const soldListing = await GiftListing.findOne({ where: { public_id: sale.id } })
      assert.equal(soldListing.closed_reason, 'sold_offer')
      assert.equal(Number(soldListing.price_nano), 3e9)
      assert.equal(sale.price_nano, '3000000000')
      assert.equal(sale.seller, undefined)
      assert.equal(sale.buyer, undefined)
      assert.equal((await request(`/offers/${offer.public_id}/accept`, { user: f.seller, method: 'POST' })).status, 409)
      assert.equal(await GiftListing.count({ where: { fk_gift_id: f.gift.pk_gift_id, status: 'sold' } }), 1)
  })
  await t.test('failure while recording a fee rolls back every part of direct and offer settlement', async () => {
    for (const kind of ['direct', 'offer']) {
      const f = await fixture()
      await request('/offers', { user: f.buyer, body: { gift_id: f.gift.public_id, amount: 3 } })
      const offer = await offerFor(f.buyer, f.gift)
      const beforeWallet = (await wallet(f.buyer)).toJSON()
      const beforeOffer = offer.toJSON()
      const beforeLedger = await WalletTransaction.count({ where: { fk_gift_id: f.gift.pk_gift_id } })
      const create = MarketplaceFeeEntry.create
      // Fail after INSERT to verify the new journal row itself is also rolled back.
      MarketplaceFeeEntry.create = async (...args) => {
        await create.apply(MarketplaceFeeEntry, args)
        throw new Error('Simulated failure after fee insertion')
      }
      let result
      try {
        result = kind === 'direct'
          ? await request('/gifts/buy', { user: f.buyer, body: f.purchase })
          : await request(`/offers/${offer.public_id}/accept`, { user: f.seller, method: 'POST' })
      } finally { MarketplaceFeeEntry.create = create }
      assert.equal(result.status, 500, JSON.stringify(result))
      assert.deepEqual((await wallet(f.buyer)).toJSON(), beforeWallet)
      assert.deepEqual((await offer.reload()).toJSON(), beforeOffer)
      assert.equal(String((await ownership(f.gift)).fk_user_id), String(f.seller.pk_user_id))
      assert.equal(Number((await wallet(f.seller)).total_nano), 0)
      assert.equal((await GiftListing.findByPk(f.listingId)).status, 'active')
      assert.equal(await WalletTransaction.count({ where: { fk_gift_id: f.gift.pk_gift_id } }), beforeLedger)
      assert.equal(await MarketplaceFeeEntry.count({ where: { fk_gift_listing_id: f.listingId } }), 0)
      assert.equal(await MarketplaceFeeEntry.count({ where: { fk_offer_id: offer.pk_offer_id } }), 0)
    }
  })
  await t.test('fee journal enforces one source, uniqueness, nonnegative amounts and immutable history', async () => {
    const f = await fixture()
    assert.equal((await request('/gifts/buy', { user: f.buyer, body: f.purchase })).status, 200)
    const fee = await MarketplaceFeeEntry.findOne({ where: { fk_gift_listing_id: f.listingId } })
    await assert.rejects(() => sequelize.transaction((transaction) => recordMarketplaceFee({
      listingId: f.listingId, amountNano: 0, currencyCode: 'GRAM', transaction,
    })), { name: 'SequelizeUniqueConstraintError' })
    for (const changes of [
      { fk_gift_listing_id: null, amount_nano: '1' },
      { fk_gift_listing_id: f.listingId, amount_nano: '-1' },
    ]) {
      await assert.rejects(() => MarketplaceFeeEntry.create(changes), (error) => error.original?.code === '23514')
    }
    await assert.rejects(() => fee.update({ amount_nano: '1' }), /append-only/)
    await assert.rejects(() => fee.destroy(), /append-only/)
    await assert.rejects(() => sequelize.query('TRUNCATE marketplace_fee_entries'), /append-only/)
    await assert.rejects(() => GiftListing.destroy({ where: { pk_gift_listing_id: f.listingId } }),
      error => ['23001', '23503'].includes(error.original?.code) &&
        error.original?.constraint === 'marketplace_fee_entries_fk_gift_listing_id_fkey')
    assert.equal((await fee.reload()).amount_nano, String(calculateMarketplaceFeeNano(5e9)))
  })
  await t.test('zero fees are recorded and revenue aggregation preserves large exact totals', async () => {
    const fixtures = await Promise.all([fixture(), fixture(), fixture()])
    const transaction = await sequelize.transaction()
    try {
      for (const [index, amount] of ['0', '9007199254740991', '11'].entries()) {
        await recordMarketplaceFee({ listingId: fixtures[index].listingId, amountNano: amount, currencyCode: 'EXACT_TEST', transaction })
      }
      const totals = await readMarketplaceRevenue({ transaction })
      assert.deepEqual(totals.find((total) => total.currency_code === 'EXACT_TEST'), {
        currency_code: 'EXACT_TEST', accrued_nano: '9007199254741002', legacy_accrued_nano: '0',
        new_accrued_nano: '9007199254741002', entries_count: '3',
      })
    } finally { await transaction.rollback() }
  })
  await t.test('revenue report requires an administrator and returns accrued income as strings', async () => {
    assert.equal((await request('/admin/marketplace/revenue')).status, 401)
    const f = await fixture()
    assert.equal((await request('/admin/marketplace/revenue', { user: f.seller })).status, 403)
    await f.seller.update({ is_admin: true })
    const result = await request('/admin/marketplace/revenue', { user: f.seller })
    assert.equal(result.status, 200, JSON.stringify(result))
    const totals = result.data.totals.find((row) => row.currency_code === 'GRAM')
    assert.match(totals.accrued_nano, /^\d+$/)
    assert.equal(BigInt(totals.accrued_nano), BigInt(totals.new_accrued_nano) + BigInt(totals.legacy_accrued_nano))
    assert.equal('available_nano' in totals, false)
  })
  await t.test('canceling and expiring offers release escrow once', async () => {
    const f = await fixture()
    for (const action of ['cancel', 'expire']) {
      const created = await request('/offers', {
        user: f.buyer,
        body: { gift_id: f.gift.public_id, amount: 3 },
      })
      assert.equal(created.status, 200, JSON.stringify(created.data))
      assert.equal(Number((await wallet(f.buyer)).locked_nano), 3e9)
      const offer = await offerFor(f.buyer, f.gift)
      if (action === 'expire') await offer.update({ expires_at: new Date(Date.now() - 10000) })
      const result = await request(`/offers/${offer.public_id}/cancel`, {
        user: f.buyer,
        method: 'POST',
      })
      assert.equal(result.status, action === 'expire' ? 409 : 200)
      assert.equal(Number((await wallet(f.buyer)).locked_nano), 0)
      assert.equal(Number((await wallet(f.buyer)).available_nano), 20e9)
      await request(`/offers/${offer.public_id}/cancel`, { user: f.buyer, method: 'POST' })
      assert.equal(Number((await wallet(f.buyer)).available_nano), 20e9)
    }
  })
  await t.test('accepting an offer consumes escrow and transfers ownership', async () => {
    const f = await fixture()
    await request('/offers', { user: f.buyer, body: { gift_id: f.gift.public_id, amount: 3 } })
    const offer = await offerFor(f.buyer, f.gift)
    const result = await request(`/offers/${offer.public_id}/accept`, {
      user: f.seller,
      method: 'POST',
    })
    assert.equal(result.status, 200, JSON.stringify(result.data))
    assert.equal(Number((await wallet(f.buyer)).locked_nano), 0)
    assert.equal(Number((await wallet(f.buyer)).total_nano), 17e9)
    assert.equal(
      Number((await wallet(f.seller)).total_nano),
      3e9 - calculateMarketplaceFeeNano(3e9)
    )
    assert.equal(String((await ownership(f.gift)).fk_user_id), String(f.buyer.pk_user_id))
  })
  await t.test(
    'insufficient funds return one error response without changing balances',
    async () => {
      const f = await fixture()
      await (await wallet(f.buyer)).update({ available_nano: 0 })
      const result = await request('/offers', {
        user: f.buyer,
        body: { gift_id: f.gift.public_id, amount: 3 },
      })
      assert.equal(result.status, 400)
      assert.equal(result.data.error, 'Insufficient available balance')
      assert.equal(Number((await wallet(f.buyer)).locked_nano), 0)
    }
  )
  await t.test('wallet invoices do not mint funds and withdrawals reserve once', async () => {
    const f = await fixture()
    const change = (kind, amount, key) => request(`/my/wallet/${kind}`, {
      user: f.buyer, body: { amount, idempotency_key: key, wallet_address: '0:' + '22'.repeat(32), network: '-3' },
    })
    const duplicates = await Promise.all(Array.from({ length: 5 }, () => change('deposit', 1, 'same-request')))
    assert.ok(duplicates.every((result) => [200, 202].includes(result.status)), JSON.stringify(duplicates))
    assert.equal(new Set(duplicates.map((result) => result.data.payment.id)).size, 1)
    assert.equal(Number((await wallet(f.buyer)).total_nano), 20e9)
    assert.equal(await WalletTransaction.count({ where: { fk_user_id: f.buyer.pk_user_id } }), 1)
    assert.equal((await change('deposit', 2, 'same-request')).status, 409)
    assert.equal((await change('withdraw', 1, 'same-request')).status, 409)
    const withdrawals = await Promise.all([change('withdraw', 15, 'withdraw-a'), change('withdraw', 15, 'withdraw-b')])
    assert.deepEqual(withdrawals.map((result) => result.status).sort(), [202, 400])
    assert.equal(Number((await wallet(f.buyer)).total_nano), 20e9)
    assert.equal(Number((await wallet(f.buyer)).available_nano), 5000000000)
    assert.equal(Number((await wallet(f.buyer)).locked_nano), 15000000000)
    const created = withdrawals.find((result) => result.status === 202)
    assert.equal(created.data.payment.amount_nano, '14950000000')
    assert.equal(created.data.payment.fee_nano, '50000000')
    assert.equal(created.data.payment.total_nano, '15000000000')
    assert.equal((await request(`/my/wallet/payments/${created.data.payment.id}`, { user: f.seller })).status, 404)
    const missingKey = await request('/my/wallet/deposit', { user: f.buyer, body: { amount: 1 } })
    assert.equal(missingKey.status, 400)
    const freshUser = await User.create({ telegram_id: String(nextId++) })
    const firstWallet = await Promise.all([1, 2].map(() => request('/my/wallet/deposit', {
      user: freshUser, body: { amount: 1, idempotency_key: 'first-wallet', wallet_address: '0:' + '22'.repeat(32), network: '-3' },
    })))
    assert.ok(firstWallet.every((result) => [200, 202].includes(result.status)), JSON.stringify(firstWallet))
    assert.equal(Number((await wallet(freshUser)).total_nano), 0)
  })
  await t.test('unconfigured transfers return a public error without modifying money', async () => {
    const f = await fixture()
    const treasury = process.env.TON_TREASURY_ADDRESS
    process.env.TON_TREASURY_ADDRESS = ''
    try {
      const result = await request('/my/wallet/deposit', {
        user: f.buyer, body: { amount: 1, idempotency_key: 'disabled', wallet_address: '0:' + '22'.repeat(32), network: '-3' },
      })
      assert.equal(result.status, 503)
      assert.equal(result.data.code, 'TON_NOT_CONFIGURED')
      assert.equal(Number((await wallet(f.buyer)).total_nano), 20e9)
    } finally { process.env.TON_TREASURY_ADDRESS = treasury }
  })
  await t.test('deposit and withdrawal roll back when their ledger write fails', async () => {
    const f = await fixture()
    for (const kind of ['deposit', 'withdraw']) {
      const create = WalletTransaction.create
      WalletTransaction.create = async () => { throw new Error('Simulated wallet ledger failure') }
      let result
      try {
        result = await request(`/my/wallet/${kind}`, {
          user: f.buyer, body: { amount: 1, idempotency_key: `rollback-${kind}`, wallet_address: '0:' + '22'.repeat(32), network: '-3' },
        })
      } finally { WalletTransaction.create = create }
      assert.equal(result.status, 500)
      assert.equal(Number((await wallet(f.buyer)).total_nano), 20e9)
      assert.equal(await WalletTransaction.count({ where: { fk_user_id: f.buyer.pk_user_id } }), 0)
    }
  })
  await t.test('ID filters and cursors cover every sort, ties, nulls and microsecond dates', async () => {
    const f = await fixture()
    for (let i = 0; i < 5; i++) {
      const model = await GiftModel.create({ fk_collection_id: f.collection.pk_collection_id, name: `Cursor ${i}`, rarity: [null, 'rare', '10', '10', '2,5%'][i] })
      const gift = await Gift.create({
        telegram_gift_id: String(nextId++), name: `Cursor-${i + 2}`, fk_collection_id: f.collection.pk_collection_id,
        fk_model_id: model.pk_model_id, fk_background_id: f.gift.fk_background_id, fk_symbol_id: f.gift.fk_symbol_id,
      })
      await Ownership.create({ fk_user_id: f.seller.pk_user_id, fk_gift_id: gift.pk_gift_id })
      await observe(gift)
      await request('/gifts/list', { user: f.seller, body: { id: gift.public_id, price: i % 2 + 1 } })
    }
    await sequelize.query(`UPDATE gift_listings SET listed_at = timestamp '2025-01-01 00:00:00' + (fk_gift_id % 3) * interval '1 microsecond'
      WHERE fk_seller_user_id = :seller`, { replacements: { seller: f.seller.pk_user_id } })
    const sorts = ['price', 'created', 'giftNumber', 'collection', 'modelRarity', 'backgroundRarity', 'symbolRarity']
      .flatMap((sort) => [`${sort}Asc`, `${sort}Desc`])
    for (const inventory of [false, true]) {
      for (const sort of sorts) {
        const page = async (cursor = null, limit = 2) => inventory
          ? getInventory(f.seller, { listed: true, collection_id: f.collection.pk_collection_id, sort, cursor, limit })
          : request(`/search?collection_id=${f.collection.pk_collection_id}&sort=${sort}&limit=${limit}${cursor ? `&cursor=${cursor}` : ''}`)
        const all = await page(null, 100)
        assert.equal(all.status, 200, JSON.stringify(all))
        assert.equal(all.data.gifts.length, 6)
        const ids = []
        let cursor = null
        for (let i = 0; i < 4; i++) {
          const result = await page(cursor, 2)
          assert.equal(result.status, 200, JSON.stringify(result))
          assert.deepEqual(Object.keys(result.data.pagination).sort(), ['has_more', 'limit', 'next_cursor'])
          ids.push(...result.data.gifts.map((gift) => gift.id))
          cursor = result.data.pagination.next_cursor
          if (!result.data.pagination.has_more) break
          assert.ok(cursor)
        }
        assert.deepEqual(ids, all.data.gifts.map((gift) => gift.id), `${inventory ? 'inventory' : 'catalog'} ${sort}`)
      }
    }
    const first = await request(`/search?collection_id=${f.collection.pk_collection_id}&limit=1`)
    const wrongSort = await request(`/search?collection_id=${f.collection.pk_collection_id}&sort=priceDesc&cursor=${first.data.pagination.next_cursor}`)
    assert.equal(wrongSort.status, 400)
    assert.equal((await request('/search?cursor=not-a-cursor')).status, 400)
    const filtered = await request(`/search?model_id=${f.model.pk_model_id}&background_id=${f.background.pk_background_id}&symbol_id=${f.symbol.pk_symbol_id}`)
    assert.deepEqual(filtered.data.gifts.map((gift) => gift.id), [f.gift.public_id])
    await GiftListing.update({ status: 'canceled', closed_reason: 'canceled_by_seller' }, { where: { fk_seller_user_id: f.seller.pk_user_id, status: 'active' } })
    let cursor = null
    const unlistedIds = []
    for (let i = 0; i < 4; i++) {
      const result = await getInventory(f.seller, { listed: false, sort: 'createdDesc', limit: 2, cursor })
      assert.equal(result.status, 200)
      unlistedIds.push(...result.data.gifts.map((gift) => gift.id))
      cursor = result.data.pagination.next_cursor
      if (!cursor) break
    }
    assert.equal(unlistedIds.length, 6)
    assert.equal(new Set(unlistedIds).size, 6)
    const [numeric] = await sequelize.query('SELECT gift_number FROM gifts WHERE pk_gift_id = :id', { replacements: { id: f.gift.pk_gift_id } })
    assert.equal(numeric[0].gift_number, '1')
    await f.gift.update({ name: 'Renamed-999' })
    const [updated] = await sequelize.query('SELECT gift_number FROM gifts WHERE pk_gift_id = :id', { replacements: { id: f.gift.pk_gift_id } })
    assert.equal(updated[0].gift_number, '999')
  })

})
