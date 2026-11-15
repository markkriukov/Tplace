import { test, expect } from '@playwright/test'

for (const short of [false, true]) {
  test(`catalog loads all pages after its content mounts late (${short ? 'short list' : 'scroll'})`, async ({ page }) => {
    const requests = []
    await page.route('**/api/search?*', async route => {
      const url = new URL(route.request().url())
      expect(url.searchParams.has('offset')).toBe(false)
      const start = Number(url.searchParams.get('cursor') ?? 0)
      requests.push(start)
      await route.fulfill({ json: {
        ok: true,
        gifts: Array.from({ length: 20 }, (_, index) => ({ id: start + index + 1 })),
        pagination: { limit: 20, has_more: start < 40, next_cursor: start < 40 ? String(start + 20) : null },
      } })
    })
    await page.goto(`/tests/e2e/fixtures/catalog-pagination.html${short ? '?short' : ''}`)
    await expect(page.getByLabel('Gift count')).toHaveText('20')
    await expect(page.getByLabel('Loading')).toHaveText('false')
    await page.getByRole('button', { name: 'Toggle catalog' }).click()
    if (!short) await page.getByTestId('sentinel').scrollIntoViewIfNeeded()
    await expect(page.getByLabel('Gift count')).toHaveText(short ? '60' : '40')
    if (!short) {
      await page.getByTestId('sentinel').scrollIntoViewIfNeeded()
      await expect(page.getByLabel('Gift count')).toHaveText('60')
    }
    await expect(page.getByTestId('sentinel')).toHaveCount(0)
    expect(requests).toEqual([0, 20, 40])
  })
}
