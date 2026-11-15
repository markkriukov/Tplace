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

test('gift values open Catalog with collection and the chosen attribute', async ({ page }) => {
  const gift = { id: 1, number: '1', collection_name: 'Bunny', price_nano: '5000000000', is_owned_by_current_user: true,
    attributes: { model: { name: 'Gold', rarity: 10 }, background: { name: 'Blue', rarity: '12,5' }, symbol: { name: 'Star', rarity: 'Unknown' } },
  }
  const pagination = { has_more: false, next_cursor: null, limit: 20, offset: 0 }
  const searchRequests = []
  const section = { total: 1, combinations: [{ collection: 'Bunny', model: 'Gold', background: 'Blue', symbol: 'Star', quantity: 1 }] }
  await page.route(url => url.pathname.startsWith('/api/'), route => {
    const url = new URL(route.request().url())
    let data = { ok: true }
    if (url.pathname === '/api/filters/catalog') data = { ...data,
      collections: [{ id: 1, display_name: 'Bunny', short_name: 'bunny' }],
      backgrounds: [{ id: 3, name: 'Blue' }], symbols: [{ id: 4, name: 'Star' }],
    }
    if (url.pathname === '/api/filters/catalog/collection') data = { ...data,
      models: [{ id: 2, name: 'Gold' }], backgrounds: [{ id: 3, name: 'Blue' }], symbols: [{ id: 4, name: 'Star' }],
    }
    if (url.pathname === '/api/my/inventory') data = { ...data, gifts: [gift], inventory_summary: { on_sale: section, not_on_sale: section }, pagination }
    if (url.pathname === '/api/search') {
      searchRequests.push(url)
      data = { ...data, gifts: [gift], pagination }
    }
    return route.fulfill({ json: data })
  })

  const decoded = (key, value) => ({
    collection: { 1: 'Bunny' }, model: { 2: 'Gold' }, background: { 3: 'Blue' }, symbol: { 4: 'Star' },
  })[key][value] ?? value
  const activeFilters = () => {
    const params = searchRequests.at(-1)?.searchParams
    if (!params) return null
    return Object.fromEntries(['collection', 'model', 'background', 'symbol'].flatMap(key => {
      const value = params.get(key) ?? params.get(`${key}_id`)
      return value ? [[key, decoded(key, value)]] : []
    }))
  }
  const openGift = async () => {
    await page.locator('.catalog .gift-image-btn').first().click()
    await expect(page.locator('.gift-menu-overlay')).toBeVisible()
    await expect(page.locator('.gift-menu-pill')).toHaveText(['1%', '1.3%', 'Unknown'])
  }

  await page.goto('/tests/e2e/fixtures/fixture.html?inventory')
  await openGift()
  await page.locator('.gift-menu-name-link').click()
  await expect(page.locator('.search-history')).toBeVisible()
  await expect(page.locator('.gift-menu-overlay')).toHaveCount(0)
  await expect.poll(activeFilters).toEqual({ collection: 'Bunny' })

  for (const [key, label, value] of [
    ['model', 'Model', 'Gold'],
    ['background', 'Background', 'Blue'],
    ['symbol', 'Pattern', 'Star'],
  ]) {
    await openGift()
    await page.getByRole('button', { name: `${label}: ${value}` }).click()
    await expect(page.locator('.gift-menu-overlay')).toHaveCount(0)
    await expect.poll(activeFilters).toEqual({ collection: 'Bunny', [key]: value })
  }
})

test('Catalog gift title applies its collection filter in the app', async ({ page }) => {
  const searchRequests = []
  const gift = { id: 1, number: '1', collection_name: 'Bunny', price_nano: '5000000000',
    attributes: { model: { name: 'Gold' }, background: { name: 'Blue' }, symbol: { name: 'Star' } } }
  await page.route(url => url.pathname.startsWith('/api/'), route => {
    const url = new URL(route.request().url())
    let data = { ok: true }
    if (url.pathname === '/api/search') {
      searchRequests.push(url)
      data = { ...data, gifts: [gift], pagination: { has_more: false, next_cursor: null } }
    }
    if (url.pathname === '/api/filters/catalog') data = { ...data,
      collections: [{ id: 1, display_name: 'Bunny', short_name: 'bunny' }],
      backgrounds: [], symbols: [],
    }
    return route.fulfill({ json: data })
  })

  await page.goto('/')
  await page.locator('.catalog .gift-image-btn').first().click()
  await page.getByRole('button', { name: 'Collection: Bunny' }).click()
  await expect(page.locator('.gift-menu-overlay')).toHaveCount(0)
  await expect.poll(() => {
    const params = searchRequests.at(-1)?.searchParams
    return params?.get('collection') ?? params?.get('collection_id')
  }).toMatch(/^(Bunny|1)$/)
})
