import { test, expect } from '@playwright/test'

const payload = id => ({ ok: true, gifts: [{ id }], pagination: { limit: 20, next_cursor: null, has_more: false } })

test('inventory follows cursors and retries the failed page without offsets', async ({ page }) => {
  const cursors = []
  const summary = { on_sale: { total: 3 }, not_on_sale: { total: 0 } }
  let fail = true
  await page.route('**/api/my/inventory?*', route => {
    const body = Object.fromEntries(new URL(route.request().url()).searchParams)
    expect(body).not.toHaveProperty('offset')
    cursors.push(body.cursor ?? null)
    if (body.cursor === 'page-2' && fail) {
      fail = false
      return route.fulfill({ status: 503, json: { ok: false, code: 'UNAVAILABLE' } })
    }
    const id = body.cursor === 'page-3' ? 3 : body.cursor === 'page-2' ? 2 : 1
    return route.fulfill({ json: {
      ...payload(id),
      ...(!body.cursor ? { inventory_summary: summary } : {}),
      pagination: { limit: 20, has_more: id < 3, next_cursor: id < 3 ? `page-${id + 1}` : null },
    } })
  })
  await page.goto('/tests/e2e/fixtures/fixture.html?inventory-session')
  await expect(page.getByLabel('Error', { exact: true })).toHaveText('UNAVAILABLE')
  await expect(page.getByLabel('Gift ids')).toHaveText('1')
  await page.getByRole('button', { name: 'Retry inventory' }).click()
  await expect(page.getByLabel('Gift ids')).toHaveText('1,2,3')
  await expect(page.getByLabel('Inventory summary')).toHaveText(JSON.stringify({ onSale: summary.on_sale, notOnSale: summary.not_on_sale }))
  expect(cursors).toEqual([null, 'page-2', 'page-2', 'page-3'])
})

test('refresh reloads every shown page and replaces the list at once', async ({ page }) => {
  const requests = []
  let held = null
  let holdLastPage = false
  await page.route('**/api/my/inventory?*', route => {
    const body = Object.fromEntries(new URL(route.request().url()).searchParams)
    requests.push([body.cursor ?? null, body.limit])
    const id = body.cursor === 'page-3' ? 3 : body.cursor === 'page-2' ? 2 : 1
    const json = { ...payload(id), pagination: { limit: 20, has_more: id < 3, next_cursor: id < 3 ? `page-${id + 1}` : null } }
    if (id === 3 && holdLastPage) { held = () => route.fulfill({ json }); return }
    return route.fulfill({ json })
  })
  await page.goto('/tests/e2e/fixtures/fixture.html?inventory-session')
  await expect(page.getByLabel('Gift ids')).toHaveText('1,2,3')
  requests.length = 0
  holdLastPage = true
  await page.getByRole('button', { name: 'Refresh inventory' }).click()
  await expect.poll(() => Boolean(held)).toBe(true)
  await expect(page.getByLabel('Gift ids')).toHaveText('1,2,3')
  held()
  await expect.poll(() => requests).toEqual([[null, '20'], ['page-2', '19'], ['page-3', '18']])
  await expect(page.getByLabel('Gift ids')).toHaveText('1,2,3')
})

test('account switch, logout and failed reload never display previous inventory', async ({ page }) => {
  let fail = false
  await page.route('**/api/my/inventory?*', route => {
    if (fail || route.request().headers().authorization === 'Bearer user-b') {
      return route.fulfill({ status: 503, json: { ok: false, code: 'UNAVAILABLE' } })
    }
    return route.fulfill({ json: payload(1) })
  })
  await page.goto('/tests/e2e/fixtures/fixture.html?inventory-session')
  await expect(page.getByLabel('Gift ids')).toHaveText('1')
  await page.getByRole('button', { name: 'Switch account' }).click()
  await expect(page.getByLabel('Error', { exact: true })).toHaveText('UNAVAILABLE')
  await expect(page.getByLabel('Gift ids')).toBeEmpty()
  await expect(page.getByLabel('Loaded', { exact: true })).toHaveText('false')
  await page.getByRole('button', { name: 'Return to A' }).click()
  await expect(page.getByLabel('Gift ids')).toHaveText('1')
  await page.getByRole('button', { name: 'Log out' }).click()
  await expect(page.getByLabel('Gift ids')).toBeEmpty()
  fail = true
  await page.getByRole('button', { name: 'Return to A' }).click()
  await expect(page.getByLabel('Error', { exact: true })).toHaveText('UNAVAILABLE')
  await expect(page.getByLabel('Gift ids')).toBeEmpty()
})

test('late response from old session is ignored and filter/section changes clear old rows', async ({ page }) => {
  let held
  await page.route('**/api/my/inventory?*', route => {
    const body = Object.fromEntries(new URL(route.request().url()).searchParams)
    if (route.request().headers().authorization === 'Bearer user-a') { held = route; return }
    if (body.q || body.listed !== 'true') return route.fulfill({ status: 503, json: { ok: false, code: 'UNAVAILABLE' } })
    return route.fulfill({ json: payload(2) })
  })
  await page.goto('/tests/e2e/fixtures/fixture.html?inventory-session')
  await expect.poll(() => Boolean(held)).toBe(true)
  await page.getByRole('button', { name: 'Switch account' }).click()
  await expect(page.getByLabel('Gift ids')).toHaveText('2')
  await held.fulfill({ json: payload(1) })
  await expect(page.getByLabel('Gift ids')).toHaveText('2')
  await page.getByRole('button', { name: 'Change section' }).click()
  await expect(page.getByLabel('Error', { exact: true })).toHaveText('UNAVAILABLE')
  await expect(page.getByLabel('Gift ids')).toBeEmpty()
  await page.getByRole('button', { name: 'Change filter' }).click()
  await expect(page.getByLabel('Gift ids')).toBeEmpty()
})
