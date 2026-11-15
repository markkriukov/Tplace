import { test, expect } from '@playwright/test'
import { mockTelegram } from './helpers/telegram.js'
import { publicId } from './helpers/public-id.js'

test.use({ locale: 'en-US', viewport: { width: 390, height: 844 } })
const gift = { id: 1, number: '1', collection_name: 'Bunny', attributes: { model: { name: 'Gold' } }, price_nano: '1000000001', listing_id: 2 }
test.beforeEach(async ({ page }) => {
  await mockTelegram(page, { platform: 'android', initData: 'test-init-data' })
  await page.route('https://nft.fragment.com/**', route => route.abort())
  await page.route(url => url.pathname.startsWith('/api/'), route => route.fulfill({ json: {
    ok: true, token: 'test-token', user: { is_admin: true }, gifts: [gift],
    pagination: { has_more: false, next_cursor: null }, transactions: [],
    collections: [], backgrounds: [], symbols: [],
    wallet: { available_nano: '1000000000', currency_code: 'GRAM' },
    profile: { stats: { gifts: 1, sales: 0, buys: 0 } },
    pricing: { min_price_nano: '1000000000', max_price_nano: '100000000000', marketplace_fee_bps: 50 },
  } }))
})

test('pending purchase cannot replace its result with a second gift', async ({ page }) => {
  let pending
  await page.route('**/api/gifts/buy', route => { pending = route })
  await page.goto('/tests/e2e/fixtures/fixture.html?purchase')
  await page.getByRole('button', { name: 'Buy fixture gift' }).click()
  await page.locator('.buy-confirm-btn').click()
  await expect.poll(() => Boolean(pending)).toBe(true)
  await page.getByRole('button', { name: 'Buy second gift' }).click()
  await expect(page.locator('.buy-confirm-overlay')).toHaveCount(0)
  await pending.fulfill({ json: { ok: true } })
  await expect(page.locator('.buy-result-text')).toContainText('Test gift')
  await expect(page.getByLabel('Purchased ids')).toHaveText('1')
})

test('cart controls and dismissal stay locked until quotes and purchases finish', async ({ page }) => {
  let quote
  let purchase
  await page.route('**/api/gifts/1/quote', route => { quote = route })
  await page.route('**/api/gifts/buy', route => { purchase = route })
  await page.goto('/tests/e2e/fixtures/fixture.html?purchase')
  await page.getByRole('button', { name: 'Open fixture cart' }).click()
  await page.locator('.cart-buy-btn').click()
  await expect.poll(() => Boolean(quote)).toBe(true)
  for (const selector of ['.cart-clear', '.cart-close-btn', '.cart-item .cart-check', '.cart-item .cart-trash']) {
    await expect(page.locator(selector)).toBeDisabled()
  }
  await page.keyboard.press('Escape')
  await expect(page.locator('.cart-overlay')).toBeVisible()
  await quote.fulfill({ json: { ok: true, quote: { listing_id: '2', price_nano: '1000000001' } } })
  await expect.poll(() => Boolean(purchase)).toBe(true)
  await expect(page.locator('.cart-clear')).toBeDisabled()
  await purchase.fulfill({ json: { ok: true } })
  await expect(page.getByLabel('Purchased ids')).toHaveText('1')
})

test('late balance read cannot overwrite a purchase balance and malformed balances allow retry', async ({ page }) => {
  let pending
  await page.route('**/api/my/wallet/balance', route => { pending = route })
  await page.goto('/tests/e2e/fixtures/fixture.html')
  await expect.poll(() => Boolean(pending)).toBe(true)
  await page.getByRole('button', { name: 'Apply purchase balance' }).click()
  await expect(page.getByLabel('Balance')).toHaveText('0.500000001')
  await pending.fulfill({ json: { ok: true, wallet: { available_nano: '1000000000' } } })
  await expect(page.getByLabel('Balance')).toHaveText('0.500000001')
  await page.route('**/api/my/wallet/balance', route => route.fulfill({ json: { ok: true, wallet: {} } }))
  await page.reload()
  await expect(page.locator('.wallet-status [role=alert]')).toBeVisible()
  await expect(page.getByLabel('Balance')).toHaveText('—')
  await page.route('**/api/my/wallet/balance', route => route.fulfill({ json: { ok: true, wallet: { available_nano: '1' } } }))
  await page.getByRole('button', { name: 'Retry' }).click()
  await expect(page.getByLabel('Balance')).toHaveText('0.000000001')
})

test('failed authentication is visible without debug and can be retried', async ({ page }) => {
  let fail = true
  await page.route('**/api/auth/telegram', route => route.fulfill({ status: fail ? 503 : 200,
    json: fail ? { ok: false } : { ok: true, token: 'recovered', user: { is_admin: false } } }))
  await page.goto('/')
  await expect(page.getByRole('alert').filter({ hasText: 'Could not sign in' })).toBeVisible()
  fail = false
  await page.getByRole('alert').getByRole('button', { name: 'Retry' }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'Could not sign in' })).toHaveCount(0)
})

test('expired authentication can be renewed without retrying a mutation', async ({ page }) => {
  let logins = 0
  let writes = 0
  await page.route('**/api/auth/telegram', route => {
    logins++
    return route.fulfill({ json: { ok: true, token: `session-${logins}`, user: { is_admin: false } } })
  })
  await page.route('**/api/gifts/buy', route => { writes++; return route.fulfill({ status: 401, json: { ok: false } }) })
  await page.goto('/')
  await page.locator('.catalog button.buy-btn').click()
  await page.locator('.buy-confirm-btn').click()
  await expect(page.getByRole('alert').filter({ hasText: 'Could not sign in' })).toBeVisible()
  await expect(page.locator('.buy-result-btn')).toHaveCount(0)
  await page.getByRole('alert').getByRole('button', { name: 'Retry' }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'Could not sign in' })).toHaveCount(0)
  expect(logins).toBe(2)
  expect(writes).toBe(1)
})

test('profile rejects malformed statistics and recovers without reopening', async ({ page }) => {
  let invalid = false
  await page.route('**/api/my/profile', route => route.fulfill({ json: {
    ok: true, profile: { stats: { gifts: invalid, sales: 0, buys: 0 } },
  } }))
  await page.goto('/tests/e2e/fixtures/fixture.html?profile')
  await page.getByRole('button', { name: 'Switch profile' }).click()
  for (const value of [false, '', -1]) {
    await test.step(`invalid count ${JSON.stringify(value)}`, async () => {
      await expect(page.locator('.profile-stats-error')).toBeVisible()
      invalid = value
      await page.locator('.profile-stats-error button').click()
      await expect(page.locator('.profile-stats-error')).toBeVisible()
    })
  }
  invalid = 2
  await page.locator('.profile-stats-error button').click()
  await expect(page.locator('.profile-stat-value')).toHaveText(['2', '0', '0'])
})

test('reopening news reloads its feed and accepts relative image paths', async ({ page }) => {
  let title = 'Old title'
  let created
  await page.route(url => url.pathname.startsWith('/api/news'), route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { ok: true, news: [{ id: 1, title, content: 'Text' }] } })
    created = route.request().postDataJSON()
    return route.fulfill({ json: { ok: true, news: { id: 2, ...created } } })
  })
  await page.goto('/tests/e2e/fixtures/fixture.html?news')
  await expect(page.locator('.news-card-title')).toHaveText(title)
  await page.getByRole('button', { name: 'Switch news' }).click()
  title = 'New title'
  await page.getByRole('button', { name: 'Switch news' }).click()
  await expect(page.locator('.news-card-title')).toHaveText(title)
  await page.locator('.news-create-toggle').click()
  await page.getByPlaceholder('Title', { exact: true }).fill('Relative image')
  await page.getByPlaceholder('News text', { exact: true }).fill('Text')
  await page.getByPlaceholder('Image URL (optional)').fill('/images/news.png')
  await page.locator('.news-create-form [type=submit]').click()
  await expect.poll(() => created?.image_url).toBe('/images/news.png')
})

test('withdrawal form follows exact updated balance and resets payments on account switch', async ({ page }) => {
  await page.route('**/api/my/wallet/balance', route => route.fulfill({ json: {
    ok: true, wallet: { available_nano: route.request().headers().authorization === 'Bearer user-a'
      ? '1000000001' : '3000000001' },
  } }))
  await page.route('**/api/my/wallet', route => {
    const first = route.request().headers().authorization === 'Bearer user-a'
    return route.fulfill({ json: { ok: true, wallet: { available_nano: first ? '1000000001' : '3000000001' },
      ton: { withdraw_fee_nano: '1', withdrawals_enabled: true, network: '-3' },
      payments: first ? [{ id: '1', kind: 'withdraw', status: 'queued', amount_nano: '1000000000', fee_nano: '1', wallet_address: 'account-a' }] : [] } })
  })
  await page.goto('/tests/e2e/fixtures/fixture.html?transfer')
  await expect(page.locator('.tx-payment-status')).toContainText('account-a')
  await page.getByRole('button', { name: 'Switch transfer account' }).click()
  await expect(page.locator('.tx-payment-status')).toHaveCount(0)
  await expect(page.locator('.tx-limit-card').first()).toContainText('3.000000001 GRAM')
  await page.getByRole('button', { name: 'Update available balance' }).click()
  await expect(page.locator('.tx-limit-card').first()).toContainText('2.000000001 GRAM')
  await page.locator('.tx-max-btn').click()
  await expect(page.locator('.tx-submit-input')).toHaveValue('2.000000001')
})

test('payment polling failures are visible and clear after recovery', async ({ page }) => {
  const instant = new Date('2026-10-08T12:00:00Z')
  await page.clock.install({ time: instant })
  await page.clock.pauseAt(instant)
  const payment = { id: '1', kind: 'withdraw', status: 'queued', amount_nano: '1000000000', fee_nano: '1', wallet_address: 'account-a' }
  await page.route('**/api/my/wallet', route => route.fulfill({ json: { ok: true,
    wallet: { available_nano: '0' }, ton: { withdraw_fee_nano: '1', network: '-3' }, payments: [payment] } }))
  let fail = true
  await page.route('**/api/my/wallet/payments/1', route => route.fulfill({ status: fail ? 404 : 200,
    json: fail ? { ok: false } : { ok: true, payment: { ...payment, status: 'completed' }, wallet: { available_nano: '0' } } }))
  await page.goto('/tests/e2e/fixtures/fixture.html?transfer')
  await expect(page.locator('.tx-payment-status')).toBeVisible()
  await page.clock.runFor(1600)
  await expect(page.locator('.tx-panel [role=alert]')).toContainText('Could not update the payment status')
  fail = false
  await page.clock.runFor(10_100)
  await expect(page.locator('.tx-panel [role=alert]')).toHaveCount(0)
  await expect(page.locator('.tx-payment-status')).toContainText('Transfer confirmed')
})

test('offers refresh on focus, retain older pages and acceptance refreshes profile counts', async ({ page }) => {
  const makeOffer = id => ({ id: publicId(id), gift_id: publicId(id), amount_nano: '1000000000', status: 'pending',
    direction: 'incoming', expires_at: '2030-01-01T00:00:00Z', gift: { title: `Gift ${id}`, number: String(id) } })
  let changed = false
  let accepted = false
  let failOlder = false
  const reads = []
  await page.route('**/api/my/profile', route => route.fulfill({ json: { ok: true,
    profile: { stats: { gifts: accepted ? 0 : 1, sales: accepted ? 1 : 0, buys: 0 } } } }))
  await page.route('**/api/my/offers?*', route => {
    const older = new URL(route.request().url()).searchParams.has('cursor')
    reads.push(older)
    if (older && failOlder) return route.fulfill({ status: 503, json: { ok: false } })
    return route.fulfill({ json: { ok: true, offers: older ? [{ ...makeOffer(1), status: changed ? 'accepted' : 'pending' }] :
      changed ? [makeOffer(3), { ...makeOffer(2), status: accepted ? 'accepted' : 'pending' }] : [makeOffer(2)],
      pagination: { has_more: !older, next_cursor: older ? null : publicId(2) }, pending_incoming_count: 1 } })
  })
  await page.route(`**/api/offers/${publicId(2)}/accept`, route => { accepted = true; return route.fulfill({ json: { ok: true } }) })
  await page.goto('/tests/e2e/fixtures/fixture.html?profile')
  await page.getByRole('button', { name: 'Switch profile' }).click()
  await expect(page.locator('.profile-stat-value')).toHaveText(['1', '0', '0'])
  await page.locator('.profile-tab-btn').filter({ hasText: 'Offers' }).click()
  await expect(page.locator('.profile-offer-name')).toContainText(['Gift 2', 'Gift 1'])
  changed = true
  failOlder = true
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.locator('.profile-offers-error')).toBeVisible()
  // A partial refresh must not publish a new head with stale older statuses.
  await expect(page.locator('.profile-offer-name')).toContainText(['Gift 2', 'Gift 1'])
  failOlder = false
  await page.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(page.locator('.profile-offer-name')).toContainText(['Gift 3', 'Gift 2', 'Gift 1'])
  await expect(page.locator('.profile-offer-card').filter({ hasText: 'Gift 1' }).locator('.profile-offer-actions button')).toHaveCount(0)
  expect(reads).toEqual([false, true, false, true, false, true])
  await page.locator('.profile-offer-card').filter({ hasText: 'Gift 2' }).locator('button.profile-offer-accept').click()
  await expect(page.locator('.profile-stat-value')).toHaveText(['0', '1', '0'])
})

test('sales history retry requests the failed page while retaining existing rows', async ({ page }) => {
  const calls = []
  let fail = true
  const item = id => ({ id, gift_id: id, gift: { title: `Sale ${id}`, number: String(id) }, price_nano: '1000000000' })
  await page.route('**/api/market/sales-history?*', route => {
    const cursor = new URL(route.request().url()).searchParams.get('cursor')
    calls.push(cursor)
    if (cursor && fail) return route.fulfill({ status: 503, json: { ok: false } })
    return route.fulfill({ json: { ok: true, items: [item(cursor ? 2 : 1)],
      pagination: { has_more: !cursor, next_cursor: cursor ? null : 'next-page' } } })
  })
  await page.goto('/')
  await page.locator('.search-history').click()
  await expect(page.locator('.sales-history-error')).toBeVisible()
  await expect(page.locator('.sales-history-item')).toHaveCount(1)
  fail = false
  await page.locator('.sales-history-panel [role=alert] button').click()
  await expect(page.locator('.sales-history-item')).toHaveCount(2)
  expect(calls).toEqual([null, 'next-page', 'next-page'])
})

test('model counts sum across collections and removing a collection prunes its model', async ({ page }) => {
  await page.route('**/api/filters/catalog', route => route.fulfill({ json: { ok: true, collections: [
    { id: 1, short_name: 'a', display_name: 'Collection A' }, { id: 2, short_name: 'b', display_name: 'Collection B' },
  ], backgrounds: [], symbols: [] } }))
  await page.route('**/api/filters/catalog/collection?*', route => {
    const first = new URL(route.request().url()).searchParams.get('collection') === 'a'
    return route.fulfill({ json: { ok: true, models: [
      { id: first ? 1 : 2, name: 'Shared', rarity: 10, on_sale_count: first ? 2 : 3 },
      { id: first ? 3 : 4, name: first ? 'Only A' : 'Only B', rarity: 'rare', on_sale_count: 1 },
    ], backgrounds: [], symbols: [] } })
  })
  await page.goto('/')
  const collection = page.locator('.filter-pill').filter({ hasText: 'Collection' })
  const model = page.locator('.filter-pill').filter({ hasText: 'Model' })
  await collection.click()
  await page.locator('.quick-panel .choose-all').click()
  await page.keyboard.press('Escape')
  await model.click()
  const shared = page.locator('.quick-panel .filter-item').filter({ hasText: 'Shared' })
  await expect(shared.locator('.item-quantity')).toHaveText('5')
  await page.locator('.quick-panel .filter-item').filter({ hasText: 'Only A' }).click()
  await page.keyboard.press('Escape')
  await expect(model).toContainText('Only A')
  await collection.click()
  await page.locator('.quick-panel .filter-item').filter({ hasText: 'Collection A' }).click()
  await page.keyboard.press('Escape')
  await expect(model).toContainText('All')
})

test('catalog body timeout displays a retry and successfully reloads', async ({ page }) => {
  await page.addInitScript(() => {
    const original = window.fetch
    const nativeTimeout = AbortSignal.timeout.bind(AbortSignal)
    AbortSignal.timeout = milliseconds => nativeTimeout(milliseconds === 15_000 ? 500 : milliseconds)
    window.auditBodyFailure = true
    window.fetch = (url, options) => {
      if (window.auditBodyFailure && String(url).includes('/api/search?')) {
        return Promise.resolve({ ok: true, status: 200, json: () => new Promise((_resolve, reject) =>
          options.signal.addEventListener('abort', () => reject(new DOMException('Body aborted', 'AbortError')), { once: true })) })
      }
      return original(url, options)
    }
  })
  await page.goto('/')
  await expect(page.locator('.catalog-loading[role=alert]')).toBeVisible()
  await page.evaluate(() => { window.auditBodyFailure = false })
  await page.locator('.catalog-loading[role=alert] button').click()
  await expect(page.locator('.catalog .gift-card')).toHaveCount(1)
  await expect(page.locator('.catalog-loading[role=alert]')).toHaveCount(0)
})
