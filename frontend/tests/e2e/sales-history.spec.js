import { test, expect } from '@playwright/test'
import { mockTelegram } from './helpers/telegram.js'

test.use({ locale: 'en-US', viewport: { width: 390, height: 844 } })

test.beforeEach(async ({ page }) => {
  await mockTelegram(page, { platform: 'android' })
  await page.route(url => url.pathname.startsWith('/api/'), route => route.fulfill({ json: {
    ok: true, gifts: [], collections: [], models: [], backgrounds: [], symbols: [],
    pagination: { has_more: false, next_cursor: null },
  } }))
})

test('History uses catalog-style filters in its server requests', async ({ page }) => {
  const historyRequests = []
  const filterRequests = []
  await page.route('**/api/market/sales-history?*', route => {
    historyRequests.push(new URL(route.request().url()))
    return route.fulfill({ json: {
      ok: true,
      items: [],
      pagination: { has_more: false, next_cursor: null },
    } })
  })
  await page.route('**/api/filters/catalog**', route => {
    const url = new URL(route.request().url())
    filterRequests.push(url)
    const collection = url.pathname.endsWith('/collection')
    return route.fulfill({ json: collection
      ? { ok: true, models: [{ id: 2, name: 'Gold' }], backgrounds: [{ id: 3, name: 'Blue' }], symbols: [{ id: 4, name: 'Star' }] }
      : { ok: true, collections: [{ id: 1, display_name: 'Bunny', short_name: 'bunny' }], backgrounds: [{ id: 3, name: 'Blue' }], symbols: [{ id: 4, name: 'Star' }] },
    })
  })

  await page.goto('/')
  await page.locator('.search-history').click()
  await expect(page.locator('.sales-history-search-row input')).toBeVisible()
  await expect(page.locator('.sales-history-filter-bar .filter-pill')).toHaveCount(4)

  await page.locator('.sales-history-filter-bar .filter-pill').filter({ hasText: 'Collection' }).click()
  await page.locator('.quick-panel .filter-item').filter({ hasText: 'Bunny' }).click()
  await page.keyboard.press('Escape')
  await expect.poll(() => historyRequests.at(-1)?.searchParams.getAll('collection')).toEqual(['Bunny'])
  await expect.poll(() => filterRequests.some(url => url.pathname.endsWith('/collection'))).toBe(true)

  for (const [group, value] of [['Model', 'Gold'], ['Background', 'Blue'], ['Pattern', 'Star']]) {
    await page.locator('.sales-history-filter-bar .filter-pill').filter({ hasText: group }).click()
    await page.locator('.quick-panel .filter-item').filter({ hasText: value }).click()
    await page.keyboard.press('Escape')
  }
  await expect.poll(() => ({
    model: historyRequests.at(-1)?.searchParams.get('model'),
    background: historyRequests.at(-1)?.searchParams.get('background'),
    symbol: historyRequests.at(-1)?.searchParams.get('symbol'),
  })).toEqual({ model: 'Gold', background: 'Blue', symbol: 'Star' })

  await page.locator('.sales-history-search-row input').fill('Bunny 123')
  await expect.poll(() => historyRequests.at(-1)?.searchParams.get('q')).toBe('Bunny 123')
  await page.locator('.sales-history-search-row .search-clear').click()

  await page.locator('.sales-history-filter-bar .filter-toggle').click()
  await page.locator('.advanced-panel input[placeholder="From"]').fill('2')
  await page.locator('.advanced-panel .sort-item').filter({ hasText: 'Price: low to high' }).click()
  await expect.poll(() => ({
    min: historyRequests.at(-1)?.searchParams.get('price_min'),
    sort: historyRequests.at(-1)?.searchParams.get('sort'),
  })).toEqual({ min: '2', sort: 'priceAsc' })
})

test('History loads the next page for price sorting', async ({ page }) => {
  const historyRequests = []
  await page.route('**/api/market/sales-history?*', route => {
    const url = new URL(route.request().url())
    historyRequests.push(url)
    const isFirstPricePage = url.searchParams.get('sort') === 'priceAsc' && !url.searchParams.has('cursor')
    return route.fulfill({ json: {
      ok: true,
      items: [],
      pagination: { has_more: isFirstPricePage, next_cursor: isFirstPricePage ? 'price-page-2' : null },
    } })
  })

  await page.goto('/')
  await page.locator('.search-history').click()
  await page.locator('.sales-history-filter-bar .filter-toggle').click()
  await page.locator('.advanced-panel .sort-item').filter({ hasText: 'Price: low to high' }).click()
  await page.keyboard.press('Escape')

  await expect.poll(() => historyRequests.some(url =>
    url.searchParams.get('sort') === 'priceAsc' && url.searchParams.get('cursor') === 'price-page-2'
  )).toBe(true)
})

test('History entries do not open a detail screen', async ({ page }) => {
  await page.route('**/api/market/sales-history?*', route => route.fulfill({ json: {
    ok: true,
    items: [{
      id: 36,
      gift_id: 3,
      gift: { title: 'MoodPack', number: '127030', collection_name: 'Mood Pack', attributes: { model: { name: 'Emo Phase' } } },
      price_nano: '1200000000',
      currency_code: 'GRAM',
      sold_at: '2026-09-28T13:24:07.107Z',
    }],
    pagination: { has_more: false, next_cursor: null },
  } }))

  await page.goto('/')
  await page.locator('.search-history').click()
  const sale = page.locator('.sales-history-item').filter({ hasText: 'MoodPack' })
  await expect(sale).toBeVisible()
  await expect(sale).toHaveCSS('cursor', 'auto')
  await sale.click()
  await expect(page.locator('.sales-history-search-row input')).toBeVisible()
  await expect(sale).toBeVisible()
  await expect(page.locator('.sales-history-detail')).toHaveCount(0)
})
