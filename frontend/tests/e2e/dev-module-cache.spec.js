import { test, expect } from '@playwright/test'
import { mockTelegram } from './helpers/telegram.js'

test.use({ locale: 'en-US', viewport: { width: 390, height: 844 } })

test('catalog and filters bypass an old cached hook after a dev server restart', async ({ page, request }) => {
  const errors = []
  let staleHookRequests = 0
  page.on('pageerror', error => errors.push(error.message))
  await mockTelegram(page, { platform: 'tdesktop' })
  await page.route(url => url.pathname.startsWith('/api/'), route => route.fulfill({ json: {
    ok: true, gifts: [], collections: [], backgrounds: [], symbols: [],
    pagination: { has_more: false },
  } }))
  // Model the unversioned .js response retained by the browser/CDN from an older
  // Vite session. Its React dispatcher no longer belongs to the current renderer.
  await page.route(url => url.pathname.endsWith('/useFilterSort.js') && !url.search, route => {
    staleHookRequests++
    return route.fulfill({ contentType: 'application/javascript', body:
      'export function useFilterSort() { throw new Error("Invalid hook call: stale React") }',
    })
  })

  const hook = await request.get('/src/features/filters/hooks/useFilterSort.js')
  expect(hook.headers()['cache-control']).toBe('no-store')
  for (let launch = 0; launch < 2; launch++) {
    await page.goto('/')
    await expect(page.getByRole('navigation')).toBeVisible()
    await page.locator('.filter-pill').filter({ hasText: 'Collection' }).click()
    await expect(page.locator('.quick-panel')).toBeVisible()
    await page.keyboard.press('Escape')
    await page.locator('.filter-toggle').click()
    await expect(page.locator('.advanced-panel')).toBeVisible()
    await page.keyboard.press('Escape')
  }
  expect(staleHookRequests).toBe(0)
  expect(errors).toEqual([])
})
