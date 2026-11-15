import { test, expect } from '@playwright/test'

test('inventory totals and In stock quantities follow sections and listing changes', async ({ page }) => {
  page.on('pageerror', error => { throw error })
  await page.setViewportSize({ width: 390, height: 844 })
  const section = (total) => ({
    total, combinations: [{ collection: 'Bunny', model: 'Gold', background: 'Blue', symbol: 'Star', quantity: total }],
  })
  let summary = { on_sale: section(25), not_on_sale: section(3) }
  const gift = { id: 1, number: '1', collection_name: 'Bunny', price_nano: '5000000000', is_owned_by_current_user: true,
    attributes: { model: { name: 'Gold' }, background: { name: 'Blue' }, symbol: { name: 'Star' } } }
  const pagination = { has_more: false, next_cursor: null, limit: 20, offset: 0 }
  let holdStorage = false
  let pendingStorage
  await page.route(url => url.pathname.startsWith('/api/'), async (route) => {
    const path = new URL(route.request().url()).pathname
    let data = { ok: true }
    if (path === '/api/filters/catalog') data = {
      ...data,
      collections: [{ id: 1, display_name: 'Bunny', short_name: 'bunny', on_sale_count: 99 }],
      backgrounds: [{ id: 1, name: 'Blue', on_sale_count: 99 }],
      symbols: [{ id: 1, name: 'Star', on_sale_count: 99 }],
    }
    if (path === '/api/filters/catalog/collection') data = {
      ...data,
      models: [{ id: 1, name: 'Gold', on_sale_count: 99 }],
      backgrounds: [{ id: 1, name: 'Blue', on_sale_count: 99 }],
      symbols: [{ id: 1, name: 'Star', on_sale_count: 99 }],
    }
    if (path === '/api/my/inventory') {
      expect(route.request().headers().authorization).toBe('Bearer test-token')
      const body = Object.fromEntries(new URL(route.request().url()).searchParams)
      data = { ...data, gifts: body.q ? [] : [gift], inventory_summary: summary, pagination }
      if (holdStorage) {
        pendingStorage = () => route.fulfill({ json: data })
        return
      }
    }
    if (path === '/api/gifts/cancel') summary = { on_sale: section(24), not_on_sale: section(4) }
    if (path === '/api/search') data = { ...data, gifts: [], pagination }
    await route.fulfill({ json: data })
  })
  await page.route('https://nft.fragment.com/**', route => route.abort())
  await page.goto('/tests/e2e/fixtures/fixture.html?inventory')
  const modes = page.getByRole('region', { name: 'Inventory sections' })
  await expect(modes.getByRole('button', { name: 'On sale 25' })).toBeVisible()
  await expect(modes.getByRole('button', { name: 'Storage 3' })).toBeVisible()
  const quickCollection = page.locator('.filter-pill').filter({ hasText: 'Collection' })
  await quickCollection.click()
  await expect(page.getByRole('dialog').getByRole('button', { name: 'In stock' })).toBeVisible()
  await expect(page.locator('.quick-list .item-quantity')).toHaveText('25')
  await page.keyboard.press('Escape')

  await modes.getByRole('button', { name: 'Storage 3' }).click()
  await quickCollection.click()
  await expect(page.locator('.quick-list .item-quantity')).toHaveText('3')
  holdStorage = true
  await page.locator('.quick-list .filter-item').click()
  await expect.poll(() => Boolean(pendingStorage)).toBe(true)
  await expect(page.locator('.quick-list .item-quantity')).toHaveText('3')
  await expect(modes.getByRole('button', { name: 'On sale 25' })).toBeVisible()
  await expect(modes.getByRole('button', { name: 'Storage 3' })).toBeVisible()
  holdStorage = false
  await pendingStorage()
  await page.keyboard.press('Escape')
  await page.locator('.filter-pill').filter({ hasText: 'Model' }).click()
  await expect(page.locator('.quick-list .item-quantity')).toHaveText('3')
  await page.keyboard.press('Escape')
  await page.locator('.filter-toggle').click()
  await expect(page.getByRole('dialog').getByRole('button', { name: 'In stock' })).toBeVisible()
  await expect(page.locator('.advanced-panel .item-quantity')).toHaveText('3')
  await page.keyboard.press('Escape')

  await page.getByPlaceholder('Search by NFT name / number').fill('missing')
  await expect(page.locator('.catalog .gift-card')).toHaveCount(0)
  await expect(modes.getByRole('button', { name: 'On sale 25' })).toBeVisible()
  await expect(modes.getByRole('button', { name: 'Storage 3' })).toBeVisible()
  await page.getByPlaceholder('Search by NFT name / number').fill('')
  await modes.getByRole('button', { name: 'On sale 25' }).click()
  await page.getByRole('button', { name: 'Cancel listing', exact: true }).click()
  await expect(modes.getByRole('button', { name: 'On sale 24' })).toBeVisible()
  await expect(modes.getByRole('button', { name: 'Storage 4' })).toBeVisible()
  await quickCollection.click()
  await expect(page.locator('.quick-list .item-quantity')).toHaveText('24')
  await page.keyboard.press('Escape')

  await page.getByRole('button', { name: 'Switch page' }).click()
  await quickCollection.click()
  await expect(page.getByRole('dialog').getByRole('button', { name: 'On sale' })).toBeVisible()
  await expect(page.locator('.quick-list .item-quantity')).toHaveText('99')
})

test('returning to the inventory shows newly deposited gifts without reloading', async ({ page }) => {
  let gifts = [{ id: 101 }]
  let calls = 0
  await page.route('**/api/my/inventory?*', async route => {
    calls += 1
    await route.fulfill({ json: {
      ok: true, gifts,
      pagination: { has_more: false, next_cursor: null, limit: 20 },
    } })
  })
  await page.goto('/tests/e2e/fixtures/fixture.html?inventory-session')
  const ids = page.getByRole('status', { name: 'Gift ids' })
  await expect(ids).toHaveText('101')
  gifts = [{ id: 102 }, { id: 101 }]
  const before = calls
  await page.evaluate(() => {
    window.dispatchEvent(new Event('focus'))
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect(ids).toHaveText('102,101')
  expect(calls).toBe(before + 1)

  await page.getByRole('button', { name: 'Log out', exact: true }).click()
  await expect(ids).toHaveText('')
  const loggedOutCalls = calls
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  expect(calls).toBe(loggedOutCalls)
})
