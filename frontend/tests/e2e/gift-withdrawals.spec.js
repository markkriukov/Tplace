import { test, expect } from '@playwright/test'

test('gift description marks only test imports', async ({ page }) => {
  await page.goto('/tests/e2e/fixtures/fixture.html?withdraw')
  await page.getByText('Open gift description').click()
  await expect(page.getByText('This is a test gift', { exact: true })).toBeVisible()
  await page.goto('/tests/e2e/fixtures/fixture.html?withdraw&ordinary')
  await page.getByText('Open gift description').click()
  await expect(page.locator('.gift-test-notice')).toHaveCount(0)
})

test('test withdrawal submits once and refreshes after success', async ({ page }) => {
  let pending
  let calls = 0
  await page.route('**/api/gifts/withdraw', route => {
    calls += 1
    expect(route.request().postDataJSON()).toEqual({ id: 123 })
    expect(route.request().headers().authorization).toBe('Bearer test-owner')
    pending = route
  })
  await page.goto('/tests/e2e/fixtures/fixture.html?withdraw')
  await page.getByText('Open withdrawal').click()
  const button = page.locator('.withdraw-confirm-btn')
  await expect(button).toHaveText('Withdraw')
  await expect(button).toBeEnabled()
  await button.click()
  await expect(button).toBeDisabled()
  await expect.poll(() => calls).toBe(1)
  await pending.fulfill({ json: { ok: true } })
  await expect(page.getByLabel('Withdrawn')).toHaveText('true')
  await expect(button).toHaveCount(0)
})

test('real withdrawal stays pending until Telegram delivery is confirmed', async ({ page }) => {
  let status = 'queued'
  let calls = 0
  const job = () => ({ id: '81', status, fee_nano: '250000000' })
  const wallet = () => ({ available_nano: '750000000', currency_code: 'GRAM' })
  await page.route('**/api/gifts/withdraw', route => {
    calls += 1
    const body = route.request().postDataJSON()
    expect(body.id).toBe(123)
    expect(body.request_key).toMatch(/^[a-f0-9-]{36}$/)
    expect(body.expected_fee_nano).toBe('250000000')
    expect(Object.keys(body).sort()).toEqual(['expected_fee_nano', 'id', 'request_key'])
    return route.fulfill({ status: 202, json: { ok: true, job: job(), wallet: wallet() } })
  })
  await page.route('**/api/gifts/withdrawals/81', route => route.fulfill({ json: { ok: true, job: job(), wallet: wallet() } }))
  await page.goto('/tests/e2e/fixtures/fixture.html?withdraw&ordinary')
  await page.getByText('Open withdrawal').click()
  await expect(page.locator('.withdraw-confirm-btn')).toHaveText('Withdraw (0.25 GRAM)')
  await page.locator('.withdraw-confirm-btn').click()
  await expect(page.getByRole('dialog').getByRole('status')).toContainText('queued')
  await expect(page.getByLabel('Withdrawal wallet')).toHaveText(JSON.stringify(wallet()))
  await expect(page.getByLabel('Withdrawn')).toHaveText('false')
  await expect(page.locator('.withdraw-confirm-btn')).toBeDisabled()
  status = 'sending'
  await expect(page.getByRole('dialog').getByRole('status')).toContainText('Sending')
  status = 'completed'
  await expect(page.getByLabel('Withdrawn')).toHaveText('true')
  await expect(page.getByLabel('Withdrawal wallet')).toHaveText(JSON.stringify(wallet()))
  await expect(page.locator('.withdraw-confirm-btn')).toHaveCount(0)
  expect(calls).toBe(1)
})

test('lost request response retries with the same key and review prevents resubmission', async ({ page }) => {
  const keys = []
  await page.route('**/api/gifts/withdraw', route => {
    keys.push(route.request().postDataJSON().request_key)
    if (keys.length === 1) return route.abort('failed')
    return route.fulfill({ status: 202, json: { ok: true, job: { id: '82', status: 'review' } } })
  })
  await page.route('**/api/gifts/withdrawals/82', route => route.fulfill({ json: { ok: true, job: { id: '82', status: 'review' } } }))
  await page.goto('/tests/e2e/fixtures/fixture.html?withdraw&ordinary')
  await page.getByText('Open withdrawal').click()
  await page.locator('.withdraw-confirm-btn').click()
  await expect(page.getByRole('alert')).toContainText('Retry')
  await page.locator('.withdraw-confirm-btn').click()
  await expect(page.getByRole('dialog').getByRole('status')).toContainText('being checked')
  await expect(page.locator('.withdraw-confirm-btn')).toBeDisabled()
  await expect(page.getByLabel('Withdrawn')).toHaveText('false')
  expect(keys).toHaveLength(2)
  expect(keys[1]).toBe(keys[0])
})

test('actual Telegram rejection shows the refreshed date without removing the gift', async ({ page }) => {
  await page.route('**/api/gifts/withdraw', route => route.fulfill({ status: 202,
    json: { ok: true, job: { id: '84', status: 'queued' } } }))
  await page.route('**/api/gifts/withdrawals/84', route => route.fulfill({ json: {
    ok: true, job: { id: '84', status: 'failed', error_code: 'TRANSFER_LOCKED', available_at: '2026-10-09T15:31:27Z' },
    wallet: { available_nano: '1000000000', currency_code: 'GRAM' },
  } }))
  await page.goto('/tests/e2e/fixtures/fixture.html?withdraw&ordinary')
  await page.getByText('Open withdrawal').click()
  await page.locator('.withdraw-confirm-btn').click()
  await expect(page.getByRole('alert')).toContainText('2026')
  await expect(page.getByRole('alert')).not.toContainText('{{date}}')
  await expect(page.getByLabel('Withdrawal wallet')).toContainText('"available_nano":"1000000000"')
  await expect(page.getByLabel('Withdrawn')).toHaveText('false')
  await expect(page.locator('.withdraw-confirm-btn')).toBeEnabled()
})

test('definitive failure allows a fresh request while preserving the gift', async ({ page }) => {
  const keys = []
  await page.route('**/api/gifts/withdraw', route => {
    keys.push(route.request().postDataJSON().request_key)
    return route.fulfill({ status: 202, json: { ok: true, job: { id: '83', status: 'queued' } } })
  })
  await page.route('**/api/gifts/withdrawals/83', route => route.fulfill({ json: {
    ok: true, job: { id: '83', status: 'failed', error_code: 'INSUFFICIENT_STARS' },
  } }))
  await page.goto('/tests/e2e/fixtures/fixture.html?withdraw&ordinary')
  await page.getByText('Open withdrawal').click()
  await page.locator('.withdraw-confirm-btn').click()
  await expect(page.getByRole('alert')).toContainText('Stars')
  await expect(page.getByLabel('Withdrawn')).toHaveText('false')
  await page.locator('.withdraw-confirm-btn').click()
  await expect.poll(() => keys.length).toBe(2)
  expect(keys[1]).not.toBe(keys[0])
})

test('insufficient GRAM keeps the gift and explains the required fee', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 640 })
  await page.route('**/api/gifts/withdraw', route => route.fulfill({ status: 409,
    json: { ok: false, code: 'INSUFFICIENT_BALANCE' } }))
  await page.goto('/tests/e2e/fixtures/fixture.html?withdraw&ordinary')
  await page.getByText('Open withdrawal').click()
  await expect(page.locator('.withdraw-confirm-btn')).toHaveText('Withdraw (0.25 GRAM)')
  await page.locator('.withdraw-confirm-btn').click()
  await expect(page.getByRole('alert')).toContainText('0.25 GRAM')
  await expect(page.getByLabel('Withdrawn')).toHaveText('false')
  await expect(page.locator('.withdraw-confirm-btn')).toBeEnabled()
  await page.locator('.withdraw-confirm-close').scrollIntoViewIfNeeded()
  await expect(page.locator('.withdraw-confirm-close')).toBeInViewport()
  await page.locator('.withdraw-confirm-btn').scrollIntoViewIfNeeded()
  await expect(page.locator('.withdraw-confirm-btn')).toBeInViewport()
})
