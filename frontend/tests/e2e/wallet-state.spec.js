import { test, expect } from '@playwright/test'
import { mockTelegram } from './helpers/telegram.js'

test.use({ locale: 'en-US', viewport: { width: 390, height: 844 } })

const wallet = { available_nano: '100000000000', currency_code: 'GRAM' }
const ton = { deposits_enabled: true, withdrawals_enabled: true, network: '-239', withdraw_fee_nano: '50000000' }

test.beforeEach(async ({ page }) => {
  await mockTelegram(page, { platform: 'android', initData: 'test-init-data' })
  await page.route('https://raw.githubusercontent.com/ton-blockchain/wallets-list/**', route => route.fulfill({ json: [] }))
  await page.route(url => url.pathname.startsWith('/api/'), route => route.fulfill({ json: {
    ok: true, token: 'test-token', user: { is_admin: true }, gifts: [],
    pagination: { has_more: false, next_cursor: null }, transactions: [],
    collections: [], backgrounds: [], symbols: [], wallet, ton, payments: [],
    profile: { stats: { gifts: 0, sales: 0, buys: 0 } },
    pricing: { min_price_nano: '1000000000', max_price_nano: '100000000000', marketplace_fee_bps: 50 },
  } }))
})

async function openTransfer(page, kind) {
  await page.locator(`.wallet-action-${kind}`).click()
  await expect(page.locator('[data-tc-modal="true"]')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('[data-tc-modal="true"]')).toHaveCount(0)
  await expect(page.locator('.tx-page')).toBeVisible()
}

test('wallet unmounts its pages while preserving the selected screen and separate transfer drafts', async ({ page }) => {
  let reads = 0
  await page.route('**/api/my/wallet', route => {
    reads++
    return route.fulfill({ json: { ok: true, wallet, ton, payments: [] } })
  })
  await page.goto('/')
  await page.locator('.wallet-balance-btn').click()
  await expect(page.locator('.wallet-connect-btn')).toBeEnabled()
  expect(reads).toBe(0)
  await openTransfer(page, 'deposit')
  await page.locator('.tx-submit-input').fill('12.345678901')
  await expect.poll(() => reads).toBe(1)
  await page.locator('.tx-back-btn').click()
  await openTransfer(page, 'withdraw')
  await page.locator('.tx-submit-input').fill('7.000000001')
  await expect.poll(() => reads).toBe(2)
  await page.getByRole('button', { name: 'Back to catalog' }).click()
  await expect(page.locator('.wallet-page, .tx-page')).toHaveCount(0)
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  expect(reads).toBe(2)
  await page.locator('.wallet-balance-btn').click()
  await expect(page.locator('.tx-title')).toHaveText('Withdraw')
  await expect(page.locator('.tx-submit-input')).toHaveValue('7.000000001')
  await expect.poll(() => reads).toBe(3)
  await page.locator('.tx-back-btn').click()
  await openTransfer(page, 'deposit')
  await expect(page.locator('.tx-submit-input')).toHaveValue('12.345678901')
})

test('payment polling pauses offscreen and a slow restoration cannot undo its fresh status on return', async ({ page }) => {
  const payment = {
    id: 'payment-a', kind: 'withdraw', status: 'queued',
    amount_nano: '1000000000', fee_nano: '50000000', wallet_address: 'account-a',
  }
  let polls = 0
  let reads = 0
  let restoration
  let complete = false
  await page.route('**/api/my/wallet', route => {
    if (++reads > 1) { restoration = route; return }
    return route.fulfill({ json: { ok: true, wallet, ton, payments: [payment] } })
  })
  await page.route('**/api/my/wallet/payments/payment-a', route => {
    polls++
    return route.fulfill({ json: { ok: true, wallet, payment: complete ? { ...payment, status: 'completed' } : payment } })
  })
  await page.goto('/')
  await page.clock.install()
  await page.locator('.wallet-balance-btn').click()
  await expect(page.locator('.wallet-connect-btn')).toBeEnabled()
  await openTransfer(page, 'withdraw')
  await expect(page.locator('.tx-payment-status')).toContainText('payment-a')
  await page.getByRole('button', { name: 'Back to catalog' }).click()
  await expect(page.locator('.tx-page')).toHaveCount(0)
  const before = polls
  await page.clock.fastForward(20_000)
  expect(polls).toBe(before)
  complete = true
  await page.locator('.wallet-balance-btn').click()
  await expect(page.locator('.tx-payment-status')).toContainText('payment-a')
  await expect.poll(() => Boolean(restoration)).toBe(true)
  await page.clock.fastForward(2_000)
  await expect.poll(() => polls).toBeGreaterThan(before)
  await expect(page.locator('.tx-payment-status')).toContainText('Transfer confirmed')
  const restored = page.waitForResponse(restoration.request().url())
  await restoration.fulfill({ json: { ok: true, wallet, ton, payments: [payment] } })
  await restored
  await expect(page.locator('.tx-payment-status')).toContainText('Transfer confirmed')
})
