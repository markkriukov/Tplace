import { test, expect } from '@playwright/test'

test('catalog on-sale counts follow the selected model, not only the collection', async ({ page }) => {
  const countRequests = []
  await page.route(url => url.pathname.startsWith('/api/'), route => {
    const url = new URL(route.request().url())
    let data = { ok: true, gifts: [], pagination: { has_more: false, next_cursor: null } }
    if (url.pathname === '/api/filters/catalog') data = { ok: true,
      collections: [{ id: 1, display_name: 'Bunny', short_name: 'bunny', on_sale_count: 9 }],
      backgrounds: [{ id: 3, name: 'Blue', on_sale_count: 6 }, { id: 5, name: 'Red', on_sale_count: 3 }],
      symbols: [{ id: 4, name: 'Star', on_sale_count: 9 }],
    }
    if (url.pathname === '/api/filters/catalog/collection') data = { ok: true,
      models: [{ id: 2, name: 'Gold', on_sale_count: 6 }, { id: 6, name: 'Silver', on_sale_count: 3 }],
      backgrounds: [{ id: 3, name: 'Blue', on_sale_count: 6 }, { id: 5, name: 'Red', on_sale_count: 3 }],
      symbols: [{ id: 4, name: 'Star', on_sale_count: 9 }],
    }
    if (url.pathname === '/api/filters/counts') {
      const criteria = Object.fromEntries(url.searchParams)
      countRequests.push(criteria)
      // Every Gold gift has a blue backdrop and every Silver gift a red one.
      const backgrounds = { 2: { 3: 6 }, 6: { 5: 3 } }[criteria.model_id] ?? { 3: 6, 5: 3 }
      data = { ok: true, counts: { collection: { 1: 9 }, model: { 2: 6, 6: 3 }, background: backgrounds, symbol: { 4: 9 } } }
    }
    return route.fulfill({ json: data })
  })
  await page.route('https://nft.fragment.com/**', route => route.abort())
  await page.goto('/tests/e2e/fixtures/fixture.html?inventory')
  await page.getByRole('button', { name: 'Switch page' }).click()

  const pill = name => page.locator('.filter-pill').filter({ hasText: name })
  const options = page.locator('.quick-list .filter-item')
  await pill('Collection').click()
  await options.filter({ hasText: 'Bunny' }).click()
  await page.keyboard.press('Escape')
  await pill('Model').click()
  await expect(options.locator('.item-quantity')).toHaveText(['6', '3'])
  await options.filter({ hasText: 'Gold' }).click()
  await page.keyboard.press('Escape')

  await pill('Background').click()
  await expect(options.locator('.item-name')).toHaveText(['Blue', 'Red'])
  await expect(options.locator('.item-quantity')).toHaveText(['6', '0'])
  expect(countRequests.at(-1)).toEqual({ collection_id: '1', model_id: '2' })
})
