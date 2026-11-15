import { test, expect } from '@playwright/test'
import { mockTelegram } from './helpers/telegram.js'

test.use({ locale: 'en-US', viewport: { width: 390, height: 844 } })

const gift = id => ({ id, number: String(id), collection_name: 'Diamond Ring', price_nano: '42600000000', listing_id: id + 100,
  attributes: { model: { name: 'Gold' }, background: { name: 'Blue' }, symbol: { name: 'Star' } } })
const results = (gifts, nextCursor = null) => ({ ok: true, gifts, pagination: { has_more: Boolean(nextCursor), next_cursor: nextCursor } })

async function openCatalog(page, firstPage) {
  await mockTelegram(page, { platform: 'android', initData: 'test-init-data' })
  await page.route('https://nft.fragment.com/**', route => route.abort())
  const held = []
  await page.route(url => url.pathname.startsWith('/api/'), route => {
    if (new URL(route.request().url()).pathname === '/api/search') {
      return held.length || route.request().url().includes('cursor=') || route.request().url().includes('q=')
        ? void held.push(route)
        : route.fulfill({ json: firstPage })
    }
    return route.fulfill({ json: { ok: true, token: 'test-token', user: {}, collections: [], backgrounds: [], symbols: [],
      wallet: { available_nano: '1', currency_code: 'GRAM' } } })
  })
  await page.goto('/')
  return held
}

test('a new search replaces the previous results with the loading grid', async ({ page }) => {
  const held = await openCatalog(page, results([gift(1)]))
  const grid = page.getByRole('main', { name: 'Catalog', exact: true })
  await expect(grid.locator('.gift-card')).toHaveCount(1)
  await page.getByPlaceholder('Search by NFT name / number').fill('110')
  await expect(grid).toHaveCount(0)
  await expect(page.locator('.gift-card-skeleton')).toHaveCount(6)
  await expect.poll(() => held.length).toBe(1)
  await held[0].fulfill({ json: results([gift(2)]) })
  await expect(page.locator('.gift-card-skeleton')).toHaveCount(0)
  await expect(grid.locator('.gift-id')).toHaveText(['#2'])
})

test('the next page loads as placeholders that continue the last row', async ({ page }) => {
  const held = await openCatalog(page, results([gift(1), gift(2), gift(3)], 'page-2'))
  const cards = page.getByRole('main', { name: 'Catalog', exact: true }).locator('> .gift-card')
  await expect(cards.and(page.locator(':not(.gift-card-skeleton)')).locator('.gift-id')).toHaveText(['#1', '#2', '#3'])
  // Three cards do not fill the screen, so the next page may already be on its way.
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  await expect.poll(() => held.length).toBe(1)
  await expect(cards).toHaveCount(5)
  const [last, placeholder] = await Promise.all([cards.nth(2).boundingBox(), cards.nth(3).boundingBox()])
  expect(placeholder.y).toBe(last.y)
  await held[0].fulfill({ json: results([gift(4)]) })
  await expect(page.locator('.gift-card-skeleton')).toHaveCount(0)
  await expect(cards).toHaveCount(4)
})
