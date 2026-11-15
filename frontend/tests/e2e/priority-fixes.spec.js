import { test, expect } from '@playwright/test'
import { mockTelegram } from './helpers/telegram.js'

test.use({ locale: 'en-US', viewport: { width: 390, height: 844 } })

const wallet = available_nano => ({ available_nano, currency_code: 'GRAM' })
const gift = { id: 1, number: '1', collection_name: 'Bunny', attributes: { model: { name: 'Gold' } },
  price_nano: '1000000001', listing_id: 2 }
const story = { id: 7, title: 'Original story', content: 'Text' }
const payment = { id: 'payment-a', kind: 'withdrawal', status: 'queued', amount_nano: '1000000000', fee_nano: '50000000' }

test.beforeEach(async ({ page }) => {
  await mockTelegram(page, { platform: 'android', initData: 'test-init-data' })
  await page.route('https://nft.fragment.com/**', route => route.abort())
  await page.route('https://raw.githubusercontent.com/ton-blockchain/wallets-list/**', route => route.fulfill({ json: [] }))
  await page.route(url => url.pathname.startsWith('/api/'), route => route.fulfill({ json: {
    ok: true, gifts: [gift], pagination: { has_more: false, next_cursor: null }, transactions: [],
    collections: [], backgrounds: [], symbols: [], wallet: wallet('5000000000'), payments: [],
    ton: { withdrawals_enabled: true, network: '-239', withdraw_fee_nano: '50000000' },
    pricing: { min_price_nano: '1000000000', max_price_nano: '100000000000', marketplace_fee_bps: 50 },
  } }))
})

for (const read of ['wallet', 'payment']) {
  test(`a delayed ${read} read cannot replace a balance from a newer transaction`, async ({ page }) => {
    let pending
    if (read === 'wallet') await page.route('**/api/my/wallet', route => { pending = route })
    else {
      await page.route('**/api/my/wallet', route => route.fulfill({ json: {
        ok: true, wallet: wallet('5000000000'), ton: {}, payments: [{ ...payment, kind: 'withdraw' }],
      } }))
      await page.route('**/api/my/wallet/payments/payment-a', route => { pending = route })
    }
    await page.goto('/tests/e2e/fixtures/fixture.html?transfer')
    await expect.poll(() => Boolean(pending)).toBe(true)
    await page.getByRole('button', { name: 'Update available balance' }).click()
    const balance = page.locator('.tx-limit-card strong').first()
    await expect(balance).toHaveText('2.000000001 GRAM')
    const received = page.waitForResponse(response => response.url() === pending.request().url())
    await pending.fulfill({ json: { ok: true, wallet: wallet('5000000000'), ton: {}, payments: [],
      payment: { ...payment, status: 'completed' } } })
    await received
    await expect(balance).toHaveText('2.000000001 GRAM')
  })
}

test('a completed payment applies its fresh balance', async ({ page }) => {
  await page.route('**/api/my/wallet', route => route.fulfill({ json: {
    ok: true, wallet: wallet('5000000000'), ton: {}, payments: [{ ...payment, kind: 'withdraw' }],
  } }))
  await page.route('**/api/my/wallet/payments/payment-a', route => route.fulfill({ json: {
    ok: true, wallet: wallet('6000000000'), payment: { ...payment, status: 'completed' },
  } }))
  await page.goto('/tests/e2e/fixtures/fixture.html?transfer')
  await expect(page.locator('.tx-limit-card strong').first()).toHaveText('6 GRAM')
})

for (const action of ['create', 'edit', 'delete']) {
  test(`a delayed news refresh cannot undo ${action}`, async ({ page }) => {
    let reads = 0
    let pending
    await page.route(url => url.pathname.startsWith('/api/news'), route => {
      const request = route.request()
      if (request.method() === 'GET') {
        if (++reads > 1) { pending = route; return }
        return route.fulfill({ json: { ok: true, news: [story] } })
      }
      return route.fulfill({ json: { ok: true, news: { ...story, id: action === 'create' ? 8 : 7,
        ...request.postDataJSON() } } })
    })
    await page.goto('/tests/e2e/fixtures/fixture.html?news')
    await expect(page.locator('.news-card-title')).toHaveText('Original story')
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect.poll(() => Boolean(pending)).toBe(true)
    const canceled = page.waitForEvent('requestfailed', { predicate: request => request.url() === pending.request().url() })
    if (action === 'create') {
      await page.locator('.news-create-toggle').click()
      await page.locator('.news-create-form input').first().fill('New story')
      await page.locator('.news-create-form textarea').fill('Text')
      await page.locator('.news-create-form [type=submit]').click()
    } else if (action === 'edit') {
      await page.getByRole('button', { name: 'Edit', exact: true }).click()
      await page.locator('.news-edit-form input').first().fill('Edited story')
      await page.locator('.news-edit-form [type=submit]').click()
    } else await page.getByRole('button', { name: 'Delete', exact: true }).click()
    const titles = action === 'create' ? ['New story', 'Original story'] : action === 'edit' ? ['Edited story'] : []
    await expect(page.locator('.news-card-title')).toHaveText(titles)
    await canceled
    await pending.fulfill({ json: { ok: true, news: [story] } })
    await expect(page.locator('.news-card-title')).toHaveText(titles)
    await expect(page.locator('.news-list')).toHaveAttribute('aria-busy', 'false')
  })
}

test('switching accounts clears the cart and the old purchase confirmation', async ({ page }) => {
  await page.goto('/tests/e2e/fixtures/fixture.html?account')
  await page.locator('.catalog button.cart-btn').click()
  await expect(page.getByLabel('Account cart ids')).toHaveText('1')
  await page.locator('.catalog button.buy-btn').click()
  await expect(page.locator('.buy-confirm-overlay')).toBeVisible()
  await page.getByRole('button', { name: 'Switch marketplace account' }).evaluate(button => button.click())
  await expect(page.getByLabel('Account cart ids')).toHaveText('')
  await expect(page.locator('.buy-confirm-overlay')).toHaveCount(0)
})

for (const action of ['buy', 'offer', 'list', 'cancel']) {
  test(`switching accounts cancels the pending ${action} and ignores its callbacks`, async ({ page }) => {
    let pending
    const endpoint = action === 'offer' ? '**/api/offers' : `**/api/gifts/${action}`
    await page.route(endpoint, route => { pending = route })
    await page.goto(`/tests/e2e/fixtures/fixture.html?account${['list', 'cancel'].includes(action) ? '&inventory' : ''}`)
    if (action === 'buy') {
      await page.locator('.catalog button.buy-btn').click()
      await page.locator('.buy-confirm-btn').click()
    } else if (action === 'offer') {
      await page.locator('.gift-image-btn').click()
      await page.locator('.gift-menu-offer-btn').click()
      await page.locator('.price-menu-submit').click()
    } else if (action === 'list') {
      await page.locator('.inventory-icon-btn').click()
      await page.locator('.price-menu-input-wrap input').fill('2')
      await page.locator('.price-menu-submit').click()
    } else await page.getByRole('button', { name: 'Cancel listing', exact: true }).click()
    await expect.poll(() => Boolean(pending)).toBe(true)
    const canceled = page.waitForEvent('requestfailed', { predicate: request => request.url() === pending.request().url() })
    await page.getByRole('button', { name: 'Switch marketplace account' }).evaluate(button => button.click())
    await canceled
    await pending.fulfill({ json: { ok: true, wallet: wallet('1000000000'), listing: { id: 3, price_nano: '2000000000' } } })
    await expect(page.getByLabel('Account wallet updates')).toHaveText('')
    await expect(page.locator('.price-menu-overlay, .buy-confirm-overlay, .buy-result-overlay, .price-result-overlay')).toHaveCount(0)
    await expect(page.locator('.gift-card')).toHaveCount(1)
  })
}

test('switching accounts stops a cart batch before its next purchase', async ({ page }) => {
  const gifts = [gift, { ...gift, id: 2, number: '2', listing_id: 3 }]
  await page.route('**/api/search?*', route => route.fulfill({ json: {
    ok: true, gifts, pagination: { has_more: false, next_cursor: null },
  } }))
  await page.route(/\/api\/gifts\/\d+\/quote$/, route => {
    const id = Number(new URL(route.request().url()).pathname.split('/')[3])
    return route.fulfill({ json: { ok: true, quote: { listing_id: id + 1, price_nano: gift.price_nano } } })
  })
  const pending = []
  await page.route('**/api/gifts/buy', route => { pending.push(route) })
  await page.goto('/tests/e2e/fixtures/fixture.html?account')
  const buttons = page.locator('.catalog button.cart-btn')
  await buttons.nth(0).click()
  await buttons.nth(1).click()
  await page.locator('.search-cart').click()
  await page.locator('.cart-buy-btn').click()
  await expect.poll(() => pending.length).toBe(1)
  const canceled = page.waitForEvent('requestfailed', { predicate: request => request.url() === pending[0].request().url() })
  await page.getByRole('button', { name: 'Switch marketplace account' }).evaluate(button => button.click())
  await canceled
  await pending[0].fulfill({ json: { ok: true, wallet: wallet('1000000000') } })
  await expect(page.getByLabel('Account cart ids')).toHaveText('')
  await expect(page.locator('.cart-overlay')).toHaveCount(0)
  await expect(page.getByLabel('Account wallet updates')).toHaveText('')
  expect(pending).toHaveLength(1)
})
