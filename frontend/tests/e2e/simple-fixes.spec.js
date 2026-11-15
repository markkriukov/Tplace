import { test, expect } from '@playwright/test'
import { mockTelegram } from './helpers/telegram.js'
import { publicId } from './helpers/public-id.js'

test.use({ locale: 'en-US', viewport: { width: 390, height: 844 } })

const gift = { id: 1, number: '1', collection_name: 'Bunny', attributes: { model: { name: 'Gold' } },
  price_nano: '1000000001', listing_id: 2 }
const pagination = { has_more: false, next_cursor: null }

test.beforeEach(async ({ page }) => {
  await mockTelegram(page, { platform: 'android', initData: 'test-init-data' })
  await page.route('https://nft.fragment.com/**', route => route.abort())
  await page.route(url => url.pathname.startsWith('/api/'), route => route.fulfill({ json: {
    ok: true, token: 'test-token', user: { is_admin: true }, gifts: [gift], pagination,
    collections: [], backgrounds: [], symbols: [], transactions: [],
    profile: { stats: { gifts: 1, sales: 0, buys: 0 } },
    wallet: { available_nano: '1000000000', currency_code: 'GRAM' },
    pricing: { min_price_nano: '1000000000', max_price_nano: '100000000000', marketplace_fee_bps: 50 },
  } }))
})

for (const offer of [false, true]) {
  test(`${offer ? 'offer' : 'listing'} submits the exact price including nano precision`, async ({ page }) => {
    const requests = []
    await page.route(offer ? '**/api/offers' : '**/api/gifts/list', route => {
      requests.push(route.request().postDataJSON())
      return route.fulfill({ json: { ok: true, ...(offer
        ? { offer: { id: publicId(3), amount_nano: '1234567891' } }
        : { listing: { id: publicId(3), price_nano: '1234567891' } }) } })
    })
    await page.goto(offer ? '/' : '/tests/e2e/fixtures/fixture.html?inventory')
    if (offer) {
      await page.locator('.catalog .gift-image-btn').click()
      await page.locator('.gift-menu-offer-btn').click()
    } else {
      await page.locator('.inventory-icon-btn').click()
    }
    const input = page.locator('.price-menu-input-wrap input')
    const submit = page.locator('.price-menu-submit')
    for (const amount of ['-10', '1e3', '1.2.3']) {
      await input.fill(amount)
      await expect(input).toHaveValue(amount)
      await expect(submit).toBeDisabled()
    }
    await input.fill('1,234567891')
    await expect(submit).toBeEnabled()
    if (offer) {
      // The buyer pays the amount entered; the seller's fee breakdown is not theirs to see.
      await expect(page.locator('.price-menu-summary')).toHaveCount(0)
      await expect(page.locator('.price-menu-panel')).not.toContainText(/Marketplace fee|You receive/)
      await expect(page.locator('.price-menu-notes')).toHaveText([
        'The owner receives the offer amount minus the marketplace fee',
        'Your funds are held and returned if the offer is rejected, canceled or expires',
      ].join(''))
    } else {
      await expect(page.locator('.price-menu-summary')).toContainText('1.234567891 GRAM')
    }
    await input.fill('1.2345678912')
    await expect(submit).toBeDisabled()
    await input.fill('1,234567891')
    await submit.click()
    await expect.poll(() => requests.length).toBe(1)
    expect(requests[0][offer ? 'amount' : 'price']).toBe('1.234567891')
    await expect(page.locator('.price-result-title')).toHaveText(offer ? 'Offer sent' : 'Price updated')
  })
}

test('offer failures follow the selected language instead of the English server message', async ({ page }) => {
  const failures = [
    ['OFFER_ABOVE_PRICE', 'Offer amount cannot exceed listed price (1 GRAM)', 'Сума офера не може перевищувати ціну продажу'],
    ['GIFT_BLOCKED', 'Gift is blocked because of a duplicate real deposit', 'Цей подарунок зараз не приймає офери'],
    ['DATABASE_BUSY', 'The service is busy. Retry shortly.', 'Не вдалося надіслати офер'],
  ]
  let attempt = 0
  await page.addInitScript(() => localStorage.setItem('tplace.language', 'uk'))
  await page.route('**/api/offers', route => {
    const [code, error] = failures[attempt++]
    return route.fulfill({ status: 400, json: { ok: false, code, error } })
  })
  await page.goto('/')
  await page.locator('.catalog .gift-image-btn').click()
  await page.locator('.gift-menu-offer-btn').click()
  for (const [, serverMessage, text] of failures) {
    await page.locator('.price-menu-submit').click()
    await expect(page.locator('.price-menu-panel')).toContainText(text)
    await expect(page.locator('.price-menu-panel')).not.toContainText(serverMessage)
  }
})

for (const removal of ['item', 'clear', 'catalog']) {
  test(`cart forgets refreshed quotes and deselection after removal through ${removal}`, async ({ page }) => {
    let currentGift = gift
    await page.route('**/api/search?*', route => route.fulfill({ json: { ok: true, gifts: [currentGift], pagination } }))
    await page.route('**/api/gifts/1/quote', route => route.fulfill({ json: {
      ok: true, quote: { listing_id: '3', price_nano: '2000000000' },
    } }))
    await page.goto('/')
    await page.locator('.catalog button.cart-btn').click()
    await page.locator('.search-cart').click()
    await page.locator('.cart-buy-btn').click()
    await expect(page.locator('.cart-item-price')).toHaveText('2 GRAM')
    await page.locator('.cart-item .cart-check').click()
    await expect(page.locator('.cart-buy-btn')).toBeDisabled()
    if (removal === 'catalog') {
      await page.keyboard.press('Escape')
      await page.locator('.catalog button.cart-btn').click()
    } else {
      await page.locator(removal === 'item' ? '.cart-item .cart-trash' : '.cart-clear').click()
      await expect(page.locator('.cart-item')).toHaveCount(0)
      await page.keyboard.press('Escape')
    }
    await expect(page.locator('.catalog button.cart-btn')).toHaveAttribute('aria-label', 'Add to cart')
    currentGift = { ...gift, listing_id: 4, price_nano: '3000000000' }
    await page.getByPlaceholder('Search by NFT name / number').fill('Bunny')
    await expect(page.locator('.catalog button.buy-btn')).toHaveText('3 GRAM')
    await page.locator('.catalog button.cart-btn').click()
    await page.locator('.search-cart').click()
    await expect(page.locator('.cart-item-price')).toHaveText('3 GRAM')
    await expect(page.locator('.cart-buy-btn')).toHaveText('3 GRAM')
    await expect(page.locator('.cart-buy-btn')).toBeEnabled()
    await expect(page.locator('.cart-item .cart-check')).toHaveClass(/cart-check-active/)
  })
}

test('select all follows option values when the filter catalog changes', async ({ page }) => {
  let name = 'Old'
  await page.route('**/api/filters/catalog', route => route.fulfill({ json: {
    ok: true, collections: [], symbols: [], backgrounds: [{ id: 1, name }],
  } }))
  await page.goto('/')
  const pill = page.locator('.filter-pill').filter({ hasText: 'Background' })
  await pill.click()
  await expect(page.locator('.quick-list .item-name')).toHaveText('Old')
  await page.locator('.quick-list .filter-item').click()
  await expect(page.locator('.choose-all')).toHaveClass(/choose-all-active/)
  name = 'New'
  await page.evaluate(async () => {
    const { request } = await import('/src/shared/api/client.js')
    await request('/gifts/cancel', { method: 'POST', body: { id: 1 } })
  })
  await expect(page.locator('.quick-list .item-name')).toHaveText('New')
  await expect(page.locator('.choose-all')).not.toHaveClass(/choose-all-active/)
  await expect(pill.locator('.filter-pill-value')).toHaveText('Old')
  await page.locator('.choose-all').click()
  await expect(page.locator('.quick-list .item-check')).toHaveClass(/item-check-active/)
  await expect(page.locator('.choose-all')).toHaveClass(/choose-all-active/)
})

test('background previews distinguish missing colors from actual black', async ({ page }) => {
  await page.route('**/api/filters/catalog', route => route.fulfill({ json: {
    ok: true, collections: [], symbols: [], backgrounds: [
      { id: 1, name: 'Missing', center_color: null, edge_color: null, pattern_color: null },
      { id: 2, name: 'Pattern only', center_color: null, edge_color: null, pattern_color: 0x112233 },
      { id: 3, name: 'Black', center_color: 0, edge_color: 0, pattern_color: null },
    ],
  } }))
  await page.goto('/')
  await page.locator('.filter-pill').filter({ hasText: 'Background' }).click()
  const icon = name => page.locator('.quick-list .filter-item').filter({ hasText: name }).locator('.item-icon-color')
  await expect(icon('Missing')).toBeVisible()
  expect(await icon('Missing').evaluate(element => element.style.background)).toBe('')
  await expect(icon('Pattern only')).toHaveCSS('background-color', 'rgb(17, 34, 51)')
  await expect(icon('Black')).toHaveCSS('background-image', /rgb\(0, 0, 0\)/)
})

test('sale cancellation stays single, reports HTTP and network errors, and permits retry', async ({ page }) => {
  const pending = []
  let canceled = false
  await page.route('**/api/my/inventory?*', route => route.fulfill({ json: { ok: true, gifts: canceled ? [] : [gift], pagination } }))
  await page.route('**/api/gifts/cancel', route => { pending.push(route) })
  await page.goto('/tests/e2e/fixtures/fixture.html?inventory')
  // The menu and inventory button reach the same mutation handler.
  await page.locator('.gift-image-btn').click()
  for (const failure of ['http', 'network']) {
    await test.step(failure, async () => {
      const count = pending.length
      await page.getByRole('button', { name: 'Cancel listing', exact: true }).evaluate(button => {
        button.click()
        button.click()
      })
      await expect.poll(() => pending.length).toBe(count + 1)
      if (failure === 'network') await pending.at(-1).abort('connectionreset')
      else await pending.at(-1).fulfill({ status: 503, json: { ok: false } })
      await expect(page.locator('.price-result-title')).toHaveText('Could not cancel sale')
      await expect(page.locator('.catalog .gift-card')).toHaveCount(1)
      await page.locator('.price-result-btn').click()
    })
  }
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Cancel listing', exact: true }).click()
  await expect.poll(() => pending.length).toBe(3)
  canceled = true
  await pending.at(-1).fulfill({ json: { ok: true } })
  await expect(page.locator('.catalog .gift-card')).toHaveCount(0)
})

test('blocked storage preserves startup, language changes and Telegram diagnostics', async ({ page }) => {
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', { get: () => {
        throw new DOMException('Storage is blocked', 'SecurityError')
      } })
    })
    await page.goto('/')
    await expect(page.locator('.catalog .gift-card')).toHaveCount(1)
    await page.locator('.bottom-nav').getByRole('button', { name: 'Profile', exact: true }).click()
    await page.locator('.profile-settings-btn').click()
    await page.getByRole('radio', { name: 'Українська' }).click()
    await expect(page.locator('html')).toHaveAttribute('lang', 'uk')
    const diagnostics = page.getByRole('switch')
    await diagnostics.click()
    await expect(diagnostics).toHaveAttribute('aria-checked', 'true')
    await expect(page.locator('.telegram-debug-panel')).toBeVisible()
    await diagnostics.click()
    await expect(diagnostics).toHaveAttribute('aria-checked', 'false')
    await expect(page.locator('.telegram-debug-panel')).toHaveCount(0)
    expect(errors).toEqual([])
})

test('price submission stays single and recovers after malformed, HTTP and network responses', async ({ page }) => {
  const pending = []
  await page.route('**/api/gifts/list', route => { pending.push(route) })
  await page.goto('/tests/e2e/fixtures/fixture.html?inventory')
  for (const [index, result] of ['invalid', 'http', 'network', 'success'].entries()) {
    await test.step(result, async () => {
      await page.locator('.inventory-icon-btn').click()
      const input = page.locator('.price-menu-input-wrap input')
      const submit = page.locator('.price-menu-submit')
      const price = String(index + 2)
      await input.fill(price)
      await expect(submit).toBeEnabled()
      await submit.click()
      await expect.poll(() => pending.length).toBe(index + 1)
      await expect(submit).toBeDisabled()
      await expect(submit).toHaveText('Saving...')
      await expect(input).toBeDisabled()
      await submit.evaluate(button => { button.click(); button.click() })
      await page.keyboard.press('Escape')
      await expect(submit).toBeVisible()
      expect(pending).toHaveLength(index + 1)
      expect(pending[index].request().postDataJSON().price).toBe(price)
      if (result === 'network') await pending[index].abort('connectionreset')
      else await pending[index].fulfill(result === 'http' ? { status: 503, json: { ok: false } }
        : { json: result === 'invalid' ? {} : { ok: true, listing: { id: publicId(3), price_nano: '5000000000' } } })
      await expect(page.locator('.price-result-title')).toHaveText(result === 'success' ? 'Price updated' : 'Could not update price')
      await page.locator('.price-result-btn').click()
    })
  }
})

test('adding another cart item preserves deselection of a gift that remains in the cart', async ({ page }) => {
  await page.route('**/api/search?*', route => route.fulfill({ json: {
    ok: true, gifts: [gift, { ...gift, id: 2, number: '2', listing_id: 3 }], pagination,
  } }))
  await page.goto('/')
  await page.locator('.catalog button.cart-btn').first().click()
  await page.locator('.search-cart').click()
  await page.locator('.cart-item .cart-check').click()
  await page.keyboard.press('Escape')
  await page.locator('.catalog button.cart-btn').nth(1).click()
  await page.locator('.search-cart').click()
  await expect(page.locator('.cart-item .cart-check').first()).not.toHaveClass(/cart-check-active/)
  await expect(page.locator('.cart-item .cart-check').nth(1)).toHaveClass(/cart-check-active/)
  await expect(page.locator('.cart-buy-btn')).toHaveText('1.000000001 GRAM')
})

const walletTransaction = id => ({
  id: publicId(id), tx_kind: 'deposit', status: 'completed', direction: 'credit',
  amount_nano: '1000000000', fee_nano: '0', created_at: '2026-01-01T00:00:00Z',
})
const walletHistoryPage = cursor => ({
  ok: true,
  transactions: (cursor === null ? [12, 11] : cursor === publicId(11) ? [9, 8] : [4]).map(walletTransaction),
  pagination: { has_more: cursor !== publicId(8), next_cursor: cursor === null ? publicId(11) : cursor === publicId(11) ? publicId(8) : null },
})

for (const failedCursor of [null, publicId(8)]) {
  test(`wallet retries only the failed ${failedCursor === null ? 'first' : 'third'} history page`, async ({ page }) => {
    const cursors = []
    const pending = []
    let fail = true
    let balanceRequests = 0
    await page.route('**/api/my/wallet/balance', route => {
      balanceRequests += 1
      return route.fulfill({ json: { ok: true, wallet: { available_nano: '1000000001' } } })
    })
    await page.route('**/api/my/wallet/transactions?*', route => {
      const cursor = new URL(route.request().url()).searchParams.get('cursor')
      cursors.push(cursor)
      if (cursor === failedCursor) {
        if (fail) return route.fulfill({ status: 503, json: { ok: false } })
        pending.push(route)
        return
      }
      return route.fulfill({ json: walletHistoryPage(cursor) })
    })
    await page.goto('/tests/e2e/fixtures/fixture.html')
    await expect(page.getByRole('alert')).toBeVisible()
    await expect(page.getByLabel('Balance')).toHaveText('1.000000001')
    const retainedCount = failedCursor === null ? '0' : '4'
    await expect(page.getByLabel('History count')).toHaveText(retainedCount)
    fail = false
    await page.getByRole('button', { name: 'Retry', exact: true }).click()
    await expect.poll(() => pending.length).toBe(1)
    await expect(page.getByLabel('History count')).toHaveText(retainedCount)
    await pending[0].fulfill({ json: walletHistoryPage(failedCursor) })
    await expect(page.getByLabel('History count')).toHaveText('5')
    await expect(page.getByRole('alert')).toHaveCount(0)
    expect(cursors).toEqual(failedCursor === null
      ? [null, null, publicId(11), publicId(8)] : [null, publicId(11), publicId(8), publicId(8)])
    expect(balanceRequests).toBe(1)
  })
}

test('retrying the wallet balance preserves already loaded history pages', async ({ page }) => {
  const balances = []
  const cursors = []
  await page.route('**/api/my/wallet/balance', route => { balances.push(route) })
  await page.route('**/api/my/wallet/transactions?*', route => {
    const cursor = new URL(route.request().url()).searchParams.get('cursor')
    cursors.push(cursor)
    return route.fulfill({ json: walletHistoryPage(cursor) })
  })
  await page.goto('/tests/e2e/fixtures/fixture.html')
  await expect(page.getByLabel('History count')).toHaveText('5')
  await expect.poll(() => balances.length).toBe(1)
  await balances[0].fulfill({ status: 503, json: { ok: false } })
  await expect(page.getByRole('alert')).toBeVisible()
  await page.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect.poll(() => balances.length).toBe(2)
  await balances[1].fulfill({ json: { ok: true, wallet: { available_nano: '2000000000' } } })
  await expect(page.getByLabel('Balance')).toHaveText('2')
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(page.getByLabel('History count')).toHaveText('5')
  expect(cursors).toEqual([null, publicId(11), publicId(8)])
})

const malformedResponses = [
  ['missing fields', { json: { ok: true } }],
  ['wrong types', { json: { ok: true, items: {}, token: ' \t ' } }],
  ['invalid JSON', { body: '{broken', contentType: 'application/json' }],
]

test('sales history rejects malformed responses and recovers to a valid empty result', async ({ page }) => {
  let response = malformedResponses[0][1]
  const requests = []
  await page.route('**/api/market/sales-history?*', route => {
    requests.push(route.request().url())
    return route.fulfill(response)
  })
  await page.goto('/')
  await page.locator('.search-history').click()
  for (const [name, malformed] of malformedResponses) {
    await test.step(name, async () => {
      response = malformed
      const count = requests.length
      await page.locator('.sales-history-search-row input').fill(name)
      await expect.poll(() => requests.length).toBeGreaterThan(count)
      await expect(page.locator('.sales-history-error')).toHaveText('Could not load sales history')
      await expect(page.locator('.sales-history-empty')).toHaveCount(0)
    })
  }
  response = { json: { ok: true, items: [], pagination } }
  await page.locator('.sales-history-search-row input').fill('Bunny')
  await expect(page.locator('.sales-history-empty')).toHaveText('No sales yet')
  await expect(page.locator('.sales-history-error')).toHaveCount(0)
})

test('authentication rejects malformed responses without retaining credentials', async ({ page }) => {
  let response = malformedResponses[0][1]
  const requests = []
  await page.route('**/api/auth/telegram', route => {
    requests.push(route.request().url())
    return route.fulfill(response)
  })
  await page.goto('/tests/e2e/fixtures/fixture.html?auth')
  for (const [name, malformed] of malformedResponses) {
    await test.step(name, async () => {
      await expect(page.getByLabel('Auth error')).toHaveText('Invalid authentication response')
      response = malformed
      const count = requests.length
      await page.getByRole('button', { name: 'Change auth session' }).click()
      await expect.poll(() => requests.length).toBeGreaterThan(count)
      await expect(page.getByLabel('Auth error')).toHaveText('Invalid authentication response')
      await expect(page.getByLabel('Auth token')).toHaveText('')
      await expect(page.getByLabel('Auth admin')).toHaveText('false')
    })
  }
})

test('sales history preserves loaded entries when a subsequent response is malformed', async ({ page }) => {
  let fail = false
  await page.route('**/api/market/sales-history?*', route => route.fulfill({ json: fail ? {} : {
    ok: true, items: [{ id: 1, gift_id: 1, gift: { title: 'Bunny', number: '1' }, price_nano: '1000000000' }], pagination,
  } }))
  await page.goto('/')
  await page.locator('.search-history').click()
  await expect(page.locator('.sales-history-item')).toHaveCount(1)
  fail = true
  await page.locator('.sales-history-search-row input').fill('Bunny')
  await expect(page.locator('.sales-history-error')).toBeVisible()
  await expect(page.locator('.sales-history-item')).toHaveCount(1)
  await expect(page.locator('.sales-history-empty')).toHaveCount(0)
})

test('changing auth sessions clears prior credentials while pending and recovers after a malformed reply', async ({ page }) => {
  let calls = 0
  const pending = []
  await page.route('**/api/auth/telegram', route => {
    calls += 1
    if (calls === 2) {
      pending.push(route)
      return
    }
    return route.fulfill({ json: {
      ok: true, token: calls === 1 ? 'previous-token' : 'new-token', user: { is_admin: calls === 1 },
    } })
  })
  await page.goto('/tests/e2e/fixtures/fixture.html?auth')
  await expect(page.getByLabel('Auth token')).toHaveText('previous-token')
  await expect(page.getByLabel('Auth admin')).toHaveText('true')
  await page.getByRole('button', { name: 'Change auth session' }).click()
  await expect.poll(() => pending.length).toBe(1)
  await expect(page.getByLabel('Auth token')).toHaveText('')
  await expect(page.getByLabel('Auth admin')).toHaveText('false')
  await pending[0].fulfill({ json: { ok: true } })
  await expect(page.getByLabel('Auth error')).toHaveText('Invalid authentication response')
  await page.getByRole('button', { name: 'Change auth session' }).click()
  await expect(page.getByLabel('Auth token')).toHaveText('new-token')
  await expect(page.getByLabel('Auth admin')).toHaveText('false')
  await expect(page.getByLabel('Auth error')).toHaveText('')
})

for (const offer of [false, true]) {
  test(`${offer ? 'offer' : 'listing'} recovers failed price rules without losing the entered amount`, async ({ page }) => {
      let loads = 0
      const pending = []
      const submissions = []
      await page.route('**/api/market/config', route => {
        loads += 1
        if (loads === 1) return route.fulfill({ status: 503, json: { ok: false } })
        pending.push(route)
      })
      await page.route(offer ? '**/api/offers' : '**/api/gifts/list', route => {
        submissions.push(route.request().postDataJSON())
        return route.fulfill({ json: { ok: true, ...(offer
          ? { offer: { id: publicId(3), amount_nano: '1234567891' } }
          : { listing: { id: publicId(3), price_nano: '1234567891' } }) } })
      })
      await page.goto(offer ? '/' : '/tests/e2e/fixtures/fixture.html?inventory')
      if (offer) {
        await page.locator('.catalog .gift-image-btn').click()
        await page.locator('.gift-menu-offer-btn').click()
      } else await page.locator('.inventory-icon-btn').click()
      const input = page.locator('.price-menu-input-wrap input')
      const submit = page.locator('.price-menu-submit')
      const retry = page.locator('.price-rules-retry')
      await expect(retry).toBeEnabled()
      await expect(page.locator('.price-menu-panel [role=alert]')).toContainText('Could not load price limits')
      await input.fill('1.234567891')
      await expect(submit).toBeDisabled()
      await retry.click()
      await expect.poll(() => pending.length).toBe(1)
      await expect(retry).toBeDisabled()
      await expect(page.locator('.price-menu-panel [role=status]')).toContainText('Loading...')
      await retry.evaluate(button => button.click())
      expect(loads).toBe(2)
      await pending[0].fulfill({ json: { ok: true, pricing: {
        min_price_nano: '1000000000', max_price_nano: '100000000000', marketplace_fee_bps: null,
      } } })
      await expect(retry).toBeEnabled()
      await expect(submit).toBeDisabled()
      await expect(input).toHaveValue('1.234567891')
      await retry.click()
      await expect.poll(() => pending.length).toBe(2)
      await pending[1].fulfill({ json: { ok: true, pricing: {
        min_price_nano: '1000000000', max_price_nano: '100000000000', marketplace_fee_bps: 50,
      } } })
      await expect(input).toHaveValue('1.234567891')
      await expect(submit).toBeEnabled()
      await expect(retry).toHaveCount(0)
      await submit.click()
      await expect.poll(() => submissions.length).toBe(1)
      expect(submissions[0][offer ? 'amount' : 'price']).toBe('1.234567891')
      await expect(page.locator('.price-result-title')).toHaveText(offer ? 'Offer sent' : 'Price updated')
  })
}

for (const view of ['profile', 'wallet']) {
  test(`${view} shows empty history only after a successful response`, async ({ page }) => {
    const requests = []
    await page.route('https://raw.githubusercontent.com/ton-blockchain/wallets-list/**', route => route.fulfill({ json: [] }))
    await page.route('**/api/my/wallet/transactions?*', route => { requests.push(route) })
    await page.goto('/')
    if (view === 'profile') await page.locator('.bottom-nav').getByRole('button', { name: 'Profile', exact: true }).click()
    else await page.locator('.wallet-balance-btn').click()
    const history = page.locator(view === 'profile' ? '.profile-history-list' : '.wallet-history')
    const empty = page.locator(view === 'profile' ? '.profile-history-empty' : '.wallet-history-empty')
    await expect.poll(() => requests.length).toBe(1)
    await expect(empty).toHaveCount(0)
    await requests[0].fulfill({ status: 503, json: { ok: false } })
    await expect(history.getByRole('alert')).toBeVisible()
    await expect(empty).toHaveCount(0)
    await history.getByRole('button', { name: 'Retry', exact: true }).click()
    await expect.poll(() => requests.length).toBe(2)
    await expect(empty).toHaveCount(0)
    await requests[1].fulfill({ json: { ok: true, transactions: [], pagination: { has_more: false, next_cursor: null } } })
    await expect(empty).toHaveText(view === 'profile' ? 'No operations yet' : 'No actions yet')
    await expect(history.getByRole('alert')).toHaveCount(0)
  })

  test(`${view} retains a valid empty history when only the balance fails`, async ({ page }) => {
    let histories = 0
    await page.route('https://raw.githubusercontent.com/ton-blockchain/wallets-list/**', route => route.fulfill({ json: [] }))
    await page.route('**/api/my/wallet/balance', route => route.fulfill({ status: 503, json: { ok: false } }))
    await page.route('**/api/my/wallet/transactions?*', route => {
      histories += 1
      return route.fulfill({ json: { ok: true, transactions: [], pagination: { has_more: false, next_cursor: null } } })
    })
    await page.goto('/')
    if (view === 'profile') await page.locator('.bottom-nav').getByRole('button', { name: 'Profile', exact: true }).click()
    else await page.locator('.wallet-balance-btn').click()
    const history = page.locator(view === 'profile' ? '.profile-history-list' : '.wallet-history')
    const empty = page.locator(view === 'profile' ? '.profile-history-empty' : '.wallet-history-empty')
    await expect(history.getByRole('alert')).toBeVisible()
    await expect(empty).toBeVisible()
    await page.route('**/api/my/wallet/balance', route => route.fulfill({ json: { ok: true, wallet: { available_nano: '1000000001' } } }))
    await history.getByRole('button', { name: 'Retry', exact: true }).click()
    await expect(history.getByRole('alert')).toHaveCount(0)
    await expect(empty).toBeVisible()
    expect(histories).toBe(1)
  })
}
