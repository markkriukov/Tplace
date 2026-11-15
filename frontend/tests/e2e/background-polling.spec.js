import { test, expect } from '@playwright/test'

async function visibility(page, state) {
  await page.evaluate(state => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: state })
    document.dispatchEvent(new Event('visibilitychange'))
  }, state)
}

test('withdrawal polling pauses while hidden and recovers immediately on return', async ({ page }) => {
  let reads = 0
  let status = 'queued'
  await page.route('**/api/gifts/withdraw', route => route.fulfill({ json: { ok: true, job: { id: '81', status } } }))
  await page.route('**/api/gifts/withdrawals/81', route => {
    reads++
    return route.fulfill({ json: { ok: true, job: { id: '81', status } } })
  })
  await page.goto('/tests/e2e/fixtures/fixture.html?withdraw&ordinary')
  const opener = page.getByText('Open withdrawal')
  await expect(opener).toBeVisible()
  await page.clock.install()
  await opener.click()
  await page.locator('.withdraw-confirm-btn').click()
  await expect(page.getByRole('dialog').getByRole('status')).toContainText('queued')
  await visibility(page, 'hidden')
  await page.clock.fastForward(60_000)
  expect(reads).toBe(0)
  status = 'completed'
  await visibility(page, 'visible')
  await expect(page.getByLabel('Withdrawn')).toHaveText('true')
  expect(reads).toBe(1)
  await page.clock.fastForward(60_000)
  expect(reads).toBe(1)
})
