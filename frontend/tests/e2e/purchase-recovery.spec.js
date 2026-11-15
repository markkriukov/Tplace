import { test, expect } from '@playwright/test'

test('single purchase recovers a lost response by repeating the same request', async ({ page }) => {
  const requests = []
  await page.route('**/api/gifts/buy', route => {
    requests.push(route.request().postDataJSON())
    if (requests.length === 1) return route.abort('connectionreset')
    return route.fulfill({ json: { ok: true } })
  })
  await page.goto('/tests/e2e/fixtures/fixture.html?purchase')
  await page.getByRole('button', { name: 'Buy fixture gift' }).click()
  await page.locator('.buy-confirm-btn').click()
  await expect(page.getByLabel('Purchased ids')).toHaveText('1')
  expect(requests).toHaveLength(2)
  expect(requests[0]).toEqual({ id: 1, listing_id: 2, expected_price_nano: '1000000001' })
  expect(requests[1]).toEqual(requests[0])
})

test('cart can replay a completed purchase after its quote disappears', async ({ page }) => {
  await page.route('**/api/gifts/1/quote', route => route.fulfill({ status: 409, json: { ok: false, code: 'LISTING_CHANGED' } }))
  await page.route('**/api/gifts/buy', route => {
    expect(route.request().postDataJSON()).toEqual({
      id: 1, listing_id: 2, expected_price_nano: '1000000001',
    })
    return route.fulfill({ json: { ok: true } })
  })
  await page.goto('/tests/e2e/fixtures/fixture.html?purchase')
  await page.getByRole('button', { name: 'Open fixture cart' }).click()
  await page.locator('.cart-buy-btn').click()
  await expect(page.getByLabel('Purchased ids')).toHaveText('1')
})

test('cart buys only selected foreign gifts and removes the ones it could not buy', async ({ page }) => {
  const quotedIds = []
  const boughtIds = []
  await page.route(/\/api\/gifts\/\d+\/quote$/, route => {
    quotedIds.push(Number(new URL(route.request().url()).pathname.split('/')[3]))
    return route.fulfill({ status: 404, json: { ok: false } })
  })
  await page.route('**/api/gifts/buy', route => {
    const { id } = route.request().postDataJSON()
    boughtIds.push(id)
    return route.fulfill({ status: id === 1 ? 200 : 409, json: id === 1
      ? { ok: true } : { ok: false, error: 'Gift is unavailable' } })
  })
  await page.goto('/tests/e2e/fixtures/fixture.html?purchase&mixed')
  await page.getByRole('button', { name: 'Open fixture cart' }).click()
  await expect(page.locator('.cart-buy-btn')).toHaveText('10.000000001 GRAM')
  await page.locator('.cart-item').filter({ hasText: 'Deselected gift' }).locator('.cart-check').click()
  await expect(page.locator('.cart-buy-btn')).toHaveText('7.000000001 GRAM')
  await page.locator('.cart-buy-btn').click()
  await expect(page.getByLabel('Purchased ids')).toHaveText('1')
  expect(quotedIds).toEqual([1, 4])
  expect(boughtIds).toEqual([1, 4])
  await expect(page.locator('.cart-checkout-result-line-success')).toContainText('Test gift')
  await expect(page.locator('.cart-checkout-result-line-error')).toHaveText([
    /Own gift.*You cannot buy your own gift/, /Unavailable gift.*Gift is unavailable/,
  ])
  await page.locator('.cart-checkout-result-btn').click()
  await page.getByRole('button', { name: 'Open fixture cart' }).click()
  // Only the gift left out of the checkout remains, still deselected.
  await expect(page.locator('.cart-item-name')).toHaveText(['Deselected gift'])
  await expect(page.locator('.cart-buy-btn')).toHaveText('0 GRAM')
  await page.locator('.cart-actions .cart-check').click()
  await expect(page.locator('.cart-buy-btn')).toHaveText('3 GRAM')
  await page.locator('.cart-actions .cart-check').click()
  await expect(page.locator('.cart-buy-btn')).toHaveText('0 GRAM')
  await expect(page.locator('.cart-buy-btn')).toBeDisabled()
})
