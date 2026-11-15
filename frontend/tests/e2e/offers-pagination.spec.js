import { test, expect } from '@playwright/test'
import { publicId } from './helpers/public-id.js'

const offer = id => ({ id: publicId(id), gift_id: publicId(id), amount_nano: '1000000000',
  status: 'pending', direction: 'incoming', created_at: '2026-01-01T00:00:00Z',
  expires_at: '2030-01-01T00:00:00Z', gift: { title: 'Bunny', number: String(id) },
})

test('incoming and outgoing offers expire without reloading or retaining actions', async ({ page }) => {
  const instant = new Date('2026-10-08T12:00:00Z')
  await page.clock.install({ time: instant })
  await page.clock.pauseAt(instant)
  let loads = 0
  await page.route('**/api/my/offers?*', route => {
    loads += 1
    return route.fulfill({ json: { ok: true, offers: ['incoming', 'outgoing'].map((direction, index) => ({
      ...offer(index + 1), direction, expires_at: new Date(instant.getTime() + 5000).toISOString(),
    })), pagination: { has_more: false, next_cursor: null }, pending_incoming_count: 1 } })
  })
  await page.goto('/tests/e2e/fixtures/fixture.html?profile')
  await page.getByRole('button', { name: 'Switch profile' }).click()
  await page.locator('.profile-tab-btn').filter({ hasText: 'Offers' }).click()
  await expect(page.locator('.profile-offer-actions button')).toHaveCount(3)
  await page.clock.runFor(6000)
  await expect(page.locator('.profile-offer-left')).toHaveText(['Expired', 'Expired'])
  await expect(page.locator('.profile-offer-actions button')).toHaveCount(0)
  await expect(page.locator('.profile-tab-badge')).toHaveCount(0)
  expect(loads).toBe(1)
})

test('offer actions check the deadline between countdown ticks', async ({ page }) => {
  const instant = new Date('2026-10-08T12:00:00Z')
  await page.clock.install({ time: instant })
  await page.clock.pauseAt(instant)
  let actions = 0
  await page.route('**/api/my/offers?*', route => route.fulfill({ json: { ok: true, offers: [{ ...offer(1),
    expires_at: new Date(instant.getTime() + 500).toISOString(),
  }], pagination: { has_more: false, next_cursor: null }, pending_incoming_count: 1 } }))
  await page.route(`**/api/offers/${publicId(1)}/accept`, route => { actions += 1; return route.fulfill({ json: { ok: true } }) })
  await page.goto('/tests/e2e/fixtures/fixture.html?profile')
  await page.getByRole('button', { name: 'Switch profile' }).click()
  await page.locator('.profile-tab-btn').filter({ hasText: 'Offers' }).click()
  const accept = page.getByRole('button', { name: 'Accept', exact: true })
  await expect(accept).toBeVisible()
  await page.clock.runFor(600)
  await accept.click()
  expect(actions).toBe(0)
  await page.clock.runFor(600)
  await expect(page.locator('.profile-offer-left')).toHaveText('Expired')
  await expect(accept).toHaveCount(0)
})
test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.route('https://nft.fragment.com/**', route => route.abort())
  await page.route('**/api/my/profile', route => route.fulfill({ json: { ok: true, profile: { stats: { gifts: 1, sales: 0, buys: 0 } } } }))
})

test('offers follow cursors, retain cards on failure, retry the same page and refresh after a decision', async ({ page }) => {
  const queries = []
  let fail = true
  let resolved = false
  await page.route('**/api/my/offers?*', route => {
    const params = new URL(route.request().url()).searchParams
    expect(params.get('limit')).toBe('20')
    const cursor = params.get('cursor')
    queries.push(cursor)
    if (cursor && fail) return route.fulfill({ status: 503, json: { ok: false } })
    const offers = resolved ? [{ ...offer(200), status: 'rejected' }]
      : cursor ? [offer(180), offer(179)] : Array.from({ length: 20 }, (_, index) => offer(200 - index))
    return route.fulfill({ json: { ok: true, offers, pending_incoming_count: cursor ? undefined : resolved ? 124 : 125,
      pagination: { has_more: !(resolved || cursor), next_cursor: resolved || cursor ? null : publicId(181) } } })
  })
  await page.route(`**/api/offers/${publicId(200)}/reject`, route => {
    resolved = true
    return route.fulfill({ json: { ok: true } })
  })
  await page.goto('/tests/e2e/fixtures/fixture.html?profile')
  await page.getByRole('button', { name: 'Switch profile' }).click()
  await page.locator('.profile-tab-btn').filter({ hasText: 'Offers' }).click()
  const cards = page.locator('.profile-offer-card')
  await expect(cards).toHaveCount(20)
  await expect(page.locator('.profile-tab-badge')).toHaveText('125')
  await cards.last().scrollIntoViewIfNeeded()
  await expect(page.locator('.profile-offers-error')).toBeVisible()
  await expect(cards).toHaveCount(20)
  fail = false
  await page.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(cards).toHaveCount(22)
  expect(queries).toEqual([null, publicId(181), publicId(181)])
  await expect(page.locator('.profile-tab-badge')).toHaveText('125')
  await cards.first().getByRole('button', { name: 'Reject' }).click()
  await expect(cards).toHaveCount(1)
  await expect(page.locator('.profile-tab-badge')).toHaveText('124')
  await expect(cards.first().getByRole('button', { name: 'Accept' })).toHaveCount(0)
  expect(queries.at(-1)).toBe(null)
})

test('switching accounts ignores a late offers response', async ({ page }) => {
  let oldRequest
  await page.route('**/api/my/offers?*', route => {
    if (route.request().headers().authorization === 'Bearer profile-user-one') { oldRequest = route; return }
    return route.fulfill({ json: { ok: true, offers: [offer(3)], pagination: { has_more: false, next_cursor: null }, pending_incoming_count: 1 } })
  })
  await page.goto('/tests/e2e/fixtures/fixture.html?profile')
  await page.getByRole('button', { name: 'Switch profile' }).click()
  await page.locator('.profile-tab-btn').filter({ hasText: 'Offers' }).click()
  await expect.poll(() => Boolean(oldRequest)).toBe(true)
  await page.getByRole('button', { name: 'Switch account' }).click()
  await page.locator('.profile-tab-btn').filter({ hasText: 'Offers' }).click()
  await expect(page.locator('.profile-offer-name')).toHaveText('Bunny #3')
  await oldRequest.fulfill({ json: { ok: true, offers: [offer(999)], pending_incoming_count: 99, pagination: { has_more: false, next_cursor: null } } })
  await expect(page.locator('.profile-offer-name')).toHaveText('Bunny #3')
  await expect(page.locator('.profile-tab-badge')).toHaveText('1')
})
