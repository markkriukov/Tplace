import { test, expect } from '@playwright/test'
import { mockTelegram } from './helpers/telegram.js'

const botUrl = 'https://t.me/t_place_bot'

test('direct browser visit shows the bot page and does not request the marketplace API', async ({ page }) => {
  await mockTelegram(page)
  const apiRequests = []
  await page.route(url => url.pathname.startsWith('/api/'), route => {
    apiRequests.push(route.request().url())
    return route.fulfill({ json: { ok: true } })
  })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Open TPlace in Telegram' })).toBeVisible()
  await expect(page.getByRole('navigation')).toHaveCount(0)
  const link = page.getByRole('link', { name: 'Open bot in Telegram' })
  await expect(link).toHaveAttribute('href', botUrl)
  await page.waitForLoadState('networkidle')
  expect(apiRequests).toEqual([])

  await page.route(botUrl, route => route.fulfill({ contentType: 'text/html', body: '<h1>Telegram bot</h1>' }))
  await link.click()
  await expect(page).toHaveURL(botUrl)
})

test('the bot page works on a narrow screen without the Telegram SDK', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 320, height: 640 }, locale: 'uk-UA' })
  const page = await context.newPage()
  await page.route('https://telegram.org/js/telegram-web-app.js*', route => route.abort())
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Відкрийте TPlace у Telegram' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Відкрити бота в Telegram' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await context.close()
})

for (const session of [
  { platform: 'unknown', initData: 'auth_date=123&hash=test&user=tester' },
  { platform: 'android', initData: '' },
  { platform: 'tdesktop', version: '6.8', initData: '' },
]) {
  test(`Telegram launch opens the marketplace (${session.initData ? 'initData' : session.platform})`, async ({ page }) => {
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await mockTelegram(page, session)
    const authRequests = []
    await page.route(url => url.pathname.startsWith('/api/'), route => {
      if (new URL(route.request().url()).pathname.endsWith('/auth/telegram')) {
        authRequests.push(route.request().postDataJSON())
        return route.fulfill({ json: { ok: true, token: 'telegram-token', user: { is_admin: false } } })
      }
      return route.fulfill({ json: { ok: true, gifts: [], pagination: { has_more: false } } })
    })
    await page.goto('/')
    await expect(page.getByRole('navigation')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Catalog', exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Open bot in Telegram' })).toHaveCount(0)
    if (session.initData) {
      await expect.poll(() => authRequests).toEqual([{ initData: session.initData }])
    }
    await page.waitForLoadState('networkidle')
    expect(errors).toEqual([])
  })
}
