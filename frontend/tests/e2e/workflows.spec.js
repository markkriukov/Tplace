import { test, expect } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.route('**/api/my/wallet/balance', route => route.fulfill({ json: { ok: true, wallet: { available_nano: '1000000001', currency_code: 'GRAM' } } }))
  await page.route('**/api/my/wallet/transactions?*', route => {
    const next = new URL(route.request().url()).searchParams.has('before_id')
    return route.fulfill({ json: { ok: true, transactions: [{ pk_wallet_tx_id: next ? 1 : 2, amount_nano: '1', fee_nano: '0', tx_kind: 'deposit', direction: 'credit', status: 'completed', created_at: '2026-01-01T00:00:00Z' }], next_cursor: next ? null : '2' } })
  })
  await page.goto('/tests/e2e/fixtures/fixture.html')
})
test('dialog traps focus, closes with Escape and restores the opener', async ({ page }) => {
  const opener = page.getByRole('button', { name: 'Open dialog' })
  await opener.click()
  await expect(page.getByRole('dialog', { name: 'Test dialog' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'First', exact: true })).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(page.getByRole('button', { name: 'Last', exact: true })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'First', exact: true })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(opener).toBeFocused()
})
test('cart survives filtering and unauthenticated gift withdrawal cannot succeed', async ({ page }) => {
  await page.getByRole('button', { name: 'Add gift' }).click()
  await page.getByRole('button', { name: 'Filter gifts' }).click()
  await expect(page.getByLabel('Cart count')).toHaveText('1')
  await page.getByRole('button', { name: 'Withdraw gift', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Test gift' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Withdraw (0.25 GRAM)', exact: true })).toBeDisabled()
})
