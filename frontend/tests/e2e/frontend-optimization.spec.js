import { test, expect } from '@playwright/test'
import { mockTelegram } from './helpers/telegram.js'

test.use({ locale: 'en-US', viewport: { width: 390, height: 844 } })

const gifts = [9, 2, 8, 3, 7, 4, 6, 5].map(id => ({
  id, number: String(id), collection_name: 'Bunny', attributes: { model: { name: 'Gold' } }, price_nano: '5000000000',
}))
const pagination = { has_more: false, next_cursor: null }

test.beforeEach(async ({ page }) => {
  await mockTelegram(page, { platform: 'android' })
  await page.route('https://nft.fragment.com/**', route => route.abort())
  await page.route(url => url.pathname.startsWith('/api/'), route => route.fulfill({ json: {
    ok: true, gifts, pagination, collections: [], backgrounds: [], symbols: [], transactions: [],
  } }))
})

test('catalog cart buttons track additions and removals independently', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.catalog .gift-card')).toHaveCount(gifts.length)
  const image = page.locator('.catalog img.gift-image').first()
  await expect(image).toHaveAttribute('src', '/gifts/signal-orb.svg')
  expect(await image.evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true)
  const buttons = page.locator('.catalog .cart-btn')
  await expect(buttons.first()).toHaveAttribute('aria-label', 'Add to cart')
  await buttons.first().click()
  await expect(buttons.first()).toHaveAttribute('aria-label', 'Remove Bunny from cart')
  await expect(buttons.nth(1)).toHaveAttribute('aria-label', 'Add to cart')
  await buttons.first().click()
  await expect(buttons.first()).toHaveAttribute('aria-label', 'Add to cart')
})

for (const inventory of [false, true]) {
  test(`${inventory ? 'inventory' : 'catalog'} debounces text and price, retaining server matches and order`, async ({ page }) => {
    const queries = []
    await page.route(url => url.pathname === (inventory ? '/api/my/inventory' : '/api/search'), route => {
      queries.push(Object.fromEntries(new URL(route.request().url()).searchParams))
      return route.fulfill({ json: { ok: true, gifts, pagination } })
    })
    await page.goto(inventory ? '/tests/e2e/fixtures/fixture.html?inventory' : '/')
    await expect(page.locator('.catalog .gift-card')).toHaveCount(gifts.length)
    const initialCount = queries.length
    await page.getByPlaceholder('Search by NFT name / number').pressSequentially('Gold', { delay: 40 })
    await expect.poll(() => queries.at(-1)?.q).toBe('Gold')
    expect(queries.slice(initialCount).map(query => query.q)).toEqual(['Gold'])
    await expect(page.locator('.catalog .gift-id')).toHaveText(gifts.map(gift => `#${gift.number}`))
    const images = page.locator('.catalog .gift-image')
    await expect(images.nth(0)).toHaveAttribute('loading', 'eager')
    await expect(images.nth(6)).toHaveAttribute('loading', 'lazy')

    await page.locator('.filter-toggle').click()
    const beforePrice = queries.length
    await page.locator('.price-row input').first().pressSequentially('1.25', { delay: 40 })
    await expect.poll(() => queries.at(-1)?.price_min).toBe('1.25')
    expect(queries.slice(beforePrice).map(query => query.price_min)).toEqual(['1.25'])
    await page.keyboard.press('Escape')
    await expect(page.locator('.catalog .gift-id')).toHaveText(gifts.map(gift => `#${gift.number}`))
  })
}

test('filter counts refresh on expiry, focus and mutations, retaining data on failure', async ({ page }) => {
  await page.clock.install()
  let count = 10
  let fail = false
  let calls = 0
  await page.route(url => url.pathname === '/api/filters/catalog', route => {
    calls++
    return route.fulfill({ status: fail ? 503 : 200, json: fail ? { ok: false } : {
      ok: true, collections: [{ id: 1, display_name: 'Bunny', short_name: 'bunny', on_sale_count: count }],
      backgrounds: [], symbols: [],
    } })
  })
  await page.goto('/')
  await page.locator('.filter-pill').filter({ hasText: 'Collection' }).click()
  const quantity = page.locator('.quick-list .item-quantity')
  await expect(quantity).toHaveText('10')
  count = 9
  await page.clock.fastForward(30_001)
  await expect(quantity).toHaveText('9')
  const beforeFocus = calls
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(quantity).toHaveText('9')
  expect(calls).toBe(beforeFocus)
  count = 8
  const browserNow = await page.evaluate(() => Date.now())
  await page.clock.setSystemTime(browserNow + 30_001)
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(quantity).toHaveText('8')
  count = 7
  await page.evaluate(async () => {
    const { request } = await import('/src/shared/api/client.js')
    await request('/gifts/cancel', { method: 'POST', body: { id: 9 } })
  })
  await expect(quantity).toHaveText('7')
  fail = true
  const beforeFailure = calls
  await page.clock.fastForward(30_001)
  await expect.poll(() => calls).toBeGreaterThan(beforeFailure)
  await expect(quantity).toHaveText('7')
})

test('collection filters fall back to API gift names and counts when the filter catalog is unavailable', async ({ page }) => {
  await page.route(url => url.pathname === '/api/filters/catalog', route => route.fulfill({ status: 503, json: { ok: false } }))
  await page.goto('/')
  await expect(page.locator('.catalog .gift-card')).toHaveCount(gifts.length)
  await page.locator('.filter-pill').filter({ hasText: 'Collection' }).click()
  await expect(page.locator('.quick-list .item-name')).toHaveText('Bunny')
  await expect(page.locator('.quick-list .item-quantity')).toHaveText(String(gifts.length))
  await page.keyboard.press('Escape')
  await expect(page.locator('.filter-pill').filter({ hasText: 'Model' })).toBeDisabled()
  await page.locator('.filter-pill').filter({ hasText: 'Collection' }).click()
  await page.locator('.quick-list .filter-item').click()
  await page.keyboard.press('Escape')
  await page.locator('.filter-pill').filter({ hasText: 'Model' }).click()
  await expect(page.locator('.quick-list .item-name')).toHaveText('Gold')
  await expect(page.locator('.quick-list .item-rarity')).toHaveText('')
})

test('TonConnect loads on first wallet visit and wallet survives navigation', async ({ page }) => {
  const sdkRequests = []
  const errors = []
  page.on('request', request => {
    if (/\/node_modules\/.*tonconnect.*\.js/i.test(request.url())) sdkRequests.push(request.url())
  })
  page.on('pageerror', error => errors.push(error.message))
  await page.route('https://raw.githubusercontent.com/ton-blockchain/wallets-list/**', route => route.fulfill({ json: [] }))
  await page.goto('/')
  await expect(page.locator('.catalog .gift-card')).toHaveCount(gifts.length)
  expect(sdkRequests).toEqual([])
  await page.locator('.wallet-balance-btn').click()
  await expect(page.locator('.wallet-page')).toBeVisible()
  await expect(page.locator('.wallet-connect-btn')).toBeEnabled()
  expect(sdkRequests.length).toBeGreaterThan(0)
  const loaded = sdkRequests.length
  await page.getByRole('button', { name: 'Back to catalog' }).click()
  await expect(page.locator('.wallet-page')).toHaveCount(0)
  await page.locator('.wallet-balance-btn').click()
  await expect(page.locator('.wallet-connect-btn')).toBeEnabled()
  expect(sdkRequests).toHaveLength(loaded)
  expect(errors).toEqual([])
})

for (const advanced of [false, true]) {
  test(`${advanced ? 'advanced' : 'quick'} filters toggle name, rarity and quantity sorting`, async ({ page }) => {
    let color2Rarity = 20
    await page.route(url => url.pathname === '/api/filters/catalog', route => route.fulfill({ json: {
      ok: true, collections: [], symbols: [], backgrounds: [
        { id: 1, name: 'Color 10', rarity: 10, on_sale_count: 2 },
        { id: 2, name: 'Color 2', rarity: color2Rarity, on_sale_count: 10 },
        { id: 3, name: 'Azure', rarity: 30, on_sale_count: 5 },
      ],
    } }))
    await page.goto('/')
    if (advanced) {
      await page.locator('.filter-toggle').click()
      await page.locator('.tag-group-head').filter({ hasText: 'Background' }).click()
    } else {
      await page.locator('.filter-pill').filter({ hasText: 'Background' }).click()
    }
    const panel = advanced
      ? page.locator('.tag-group').filter({ has: page.locator('.tag-group-head', { hasText: 'Background' }) })
      : page.locator('.quick-panel')
    const names = panel.locator('.item-name')
    await expect(names).toHaveText(['Color 10', 'Color 2', 'Azure'])
    for (const [label, ascending] of [
      ['Name', ['Azure', 'Color 2', 'Color 10']],
      ['On sale', ['Color 10', 'Azure', 'Color 2']],
      ['Rarity', ['Color 10', 'Color 2', 'Azure']],
    ]) {
      const button = panel.locator('.column-sort-btn').filter({ hasText: label })
      await button.click()
      await expect(names).toHaveText(ascending)
      await expect(button.locator('.sort-indicator-active')).toHaveText('▲')
      await button.click()
      await expect(names).toHaveText([...ascending].reverse())
      await expect(button.locator('.sort-indicator-active')).toHaveText('▼')
    }
    await panel.getByPlaceholder('Search').fill('Color')
    await expect(names).toHaveText(['Color 2', 'Color 10'])
    await panel.locator('.filter-item').first().click()
    await expect(panel.locator('.filter-item').first().locator('.item-check')).toHaveClass(/item-check-active/)
    if (advanced) {
      await page.keyboard.press('Escape')
      await expect(page.locator('.advanced-overlay')).toHaveCount(0)
      color2Rarity = 5
      await page.evaluate(async () => {
        const { request } = await import('/src/shared/api/client.js')
        await request('/gifts/cancel', { method: 'POST', body: { id: 9 } })
      })
      await page.locator('.filter-toggle').click()
      await expect(panel.getByPlaceholder('Search')).toHaveValue('Color')
      await expect(names).toHaveText(['Color 10', 'Color 2'])
    }
  })
}
