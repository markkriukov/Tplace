import { test, expect } from '@playwright/test'
import { publicId } from './helpers/public-id.js'

test.use({ locale: 'en-GB' })

const publishedAt = '2026-03-15T12:00:00Z'
const initialNews = { id: publicId(7), title: 'Market update', lead: 'Lead', content: 'News content', published_at: publishedAt }
const formatDate = (page, language) => page.evaluate(({ publishedAt, language }) => (
  new Intl.DateTimeFormat(language === 'uk' ? 'uk-UA' : 'en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
  }).format(new Date(publishedAt))
), { publishedAt, language })

test('news unmounts while its cached feed and both editor drafts survive navigation', async ({ page }) => {
  let loads = 0
  let refresh
  await page.route('**/api/news?*', route => {
    if (++loads === 1) return route.fulfill({ json: { ok: true, news: [initialNews] } })
    refresh = route
  })
  await page.goto('/tests/e2e/fixtures/fixture.html?news')
  await expect(page.locator('.news-card-title')).toHaveText('Market update')
  await page.locator('.news-create-toggle').click()
  const create = page.locator('.news-create-form')
  await create.getByPlaceholder('Title', { exact: true }).fill('Creation draft')
  await create.getByPlaceholder('News text', { exact: true }).fill('Unpublished text')
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await page.locator('.news-edit-form input').first().fill('Editing draft')
  await page.locator('.news-edit-form textarea').fill('Unsaved edit')
  await page.getByRole('button', { name: 'Switch news' }).click()
  await expect(page.locator('.news-page')).toHaveCount(0)
  await page.evaluate(() => {
    window.dispatchEvent(new Event('focus'))
    document.dispatchEvent(new Event('visibilitychange'))
  })
  expect(loads).toBe(1)
  await page.getByRole('button', { name: 'Switch news' }).click()
  await expect.poll(() => Boolean(refresh)).toBe(true)
  await expect(page.locator('.news-card-title')).toHaveText('Market update')
  await expect(page.locator('.news-loading')).toHaveCount(0)
  await expect(create.getByPlaceholder('Title', { exact: true })).toHaveValue('Creation draft')
  await expect(create.getByPlaceholder('News text', { exact: true })).toHaveValue('Unpublished text')
  await expect(page.locator('.news-edit-form input').first()).toHaveValue('Editing draft')
  await expect(page.locator('.news-edit-form textarea')).toHaveValue('Unsaved edit')
  await refresh.fulfill({ json: { ok: true, news: [{ ...initialNews, title: 'Updated feed' }] } })
  await expect(page.locator('.news-card-title')).toHaveText('Updated feed')
  await expect(page.locator('.news-edit-form input').first()).toHaveValue('Editing draft')
})

test('a news save finishes after the page unmounts and closes only its successful draft', async ({ page }) => {
  let pending
  let stories = [initialNews]
  await page.route(url => url.pathname.startsWith('/api/news'), route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { ok: true, news: stories } })
    pending = route
  })
  await page.goto('/tests/e2e/fixtures/fixture.html?news')
  await expect(page.locator('.news-card-title')).toHaveText('Market update')
  await page.locator('.news-create-toggle').click()
  await page.locator('.news-create-form input').first().fill('Saved while away')
  await page.locator('.news-create-form textarea').fill('Text')
  await page.locator('.news-create-form [type=submit]').click()
  await expect.poll(() => Boolean(pending)).toBe(true)
  await page.getByRole('button', { name: 'Switch news' }).click()
  await expect(page.locator('.news-page')).toHaveCount(0)
  const created = { ...pending.request().postDataJSON(), id: publicId(8) }
  stories = [created, initialNews]
  const response = page.waitForResponse(pending.request().url())
  await pending.fulfill({ json: { ok: true, news: created } })
  await response
  await page.getByRole('button', { name: 'Switch news' }).click()
  await expect(page.locator('.news-card-title')).toHaveText(['Saved while away', 'Market update'])
  await expect(page.locator('.news-create-form')).toHaveCount(0)
})

test('language changes translate existing news dates without another request', async ({ page }) => {
  let loads = 0
  await page.route('**/api/news?*', route => {
    loads++
    return route.fulfill({ json: { ok: true, news: [
      initialNews, { id: publicId(8), title: 'Undated', published_at: 'invalid' }, null, { id: 0 },
    ] } })
  })
  await page.goto('/tests/e2e/fixtures/fixture.html?news')
  await expect(page.locator('.news-card-title')).toHaveText(['Market update', 'Undated'])
  await expect(page.locator('.news-card-date')).toHaveText([await formatDate(page, 'en'), ''])
  await page.getByRole('button', { name: 'Ukrainian', exact: true }).click()
  await expect(page.locator('.news-card-date')).toHaveText([await formatDate(page, 'uk'), ''])
  await page.getByRole('button', { name: 'English', exact: true }).click()
  await expect(page.locator('.news-card-date')).toHaveText([await formatDate(page, 'en'), ''])
  expect(loads).toBe(1)
})

test('create, edit and delete retain the current language when a request finishes', async ({ page }) => {
  let loads = 0
  let releaseCreate
  const createPending = new Promise(resolve => { releaseCreate = resolve })
  let createdBody
  await page.route(url => url.pathname.startsWith('/api/news'), async route => {
    const request = route.request()
    if (request.method() === 'GET') {
      loads++
      return route.fulfill({ json: { ok: true, news: [initialNews] } })
    }
    if (request.method() === 'DELETE') return route.fulfill({ json: { ok: true } })
    const body = request.postDataJSON()
    if (new URL(request.url()).pathname === '/api/news') {
      createdBody = body
      await createPending
    }
    return route.fulfill({ json: { ok: true, news: { ...body, id: publicId(9), published_at: publishedAt } } })
  })
  await page.goto('/tests/e2e/fixtures/fixture.html?news')
  await expect(page.locator('.news-card-title')).toHaveText('Market update')
  await page.locator('.news-create-toggle').click()
  const createForm = page.locator('.news-create-form')
  await createForm.getByPlaceholder('Title', { exact: true }).fill('New story')
  await createForm.getByPlaceholder('News text', { exact: true }).fill('New text')
  await createForm.locator('[type=submit]').click()
  await expect.poll(() => createdBody?.title).toBe('New story')
  await page.getByRole('button', { name: 'Ukrainian', exact: true }).click()
  releaseCreate()
  await expect(page.locator('.news-card-title')).toHaveText(['New story', 'Market update'])
  const ukrainianDate = await formatDate(page, 'uk')
  await expect(page.locator('.news-card-date')).toHaveText([ukrainianDate, ukrainianDate])
  const newCard = page.locator('.news-card').first()
  await newCard.locator('.news-admin-btn').first().click()
  await newCard.locator('.news-edit-form input[type=text]').first().fill('Edited story')
  await newCard.locator('.news-edit-form [type=submit]').click()
  await expect(newCard.locator('.news-card-title')).toHaveText('Edited story')
  await page.getByRole('button', { name: 'English', exact: true }).click()
  const englishDate = await formatDate(page, 'en')
  await expect(page.locator('.news-card-date')).toHaveText([englishDate, englishDate])
  await newCard.locator('.news-admin-btn-danger').click()
  await expect(page.locator('.news-card-title')).toHaveText(['Market update'])
  expect(loads).toBe(1)
})

test('failed news loading can be retried in the selected language', async ({ page }) => {
  let loads = 0
  await page.route('**/api/news?*', route => {
    loads++
    return route.fulfill({ status: loads === 1 ? 503 : 200, json: loads === 1
      ? { ok: false } : { ok: true, news: [initialNews] } })
  })
  await page.goto('/tests/e2e/fixtures/fixture.html?news')
  await expect(page.getByRole('alert')).toBeVisible()
  await page.getByRole('button', { name: 'Ukrainian', exact: true }).click()
  await page.locator('.news-load-error button').click()
  await expect(page.locator('.news-card-date')).toHaveText(await formatDate(page, 'uk'))
  await expect(page.getByRole('alert')).toHaveCount(0)
  expect(loads).toBe(2)
})

test('news editors prevent duplicate saves and recover from failure before a successful retry', async ({ page }) => {
  const pending = []
  const stories = [initialNews, { ...initialNews, id: publicId(8), title: 'Second story' }]
  await page.route('**/api/news?*', route => route.fulfill({ json: { ok: true, news: stories } }))
  await page.route(`**/api/news/${publicId(7)}`, route => { pending.push(route) })
  await page.goto('/tests/e2e/fixtures/fixture.html?news')
  const cards = page.locator('.news-card')
  await cards.first().getByRole('button', { name: 'Edit', exact: true }).click()
  const form = cards.first().locator('.news-edit-form')
  await form.locator('input').first().fill('First edited')
  for (const [index, success] of [false, true].entries()) {
    await test.step(success ? 'retry succeeds' : 'failure retains draft', async () => {
      await form.locator('[type=submit]').click()
      await expect.poll(() => pending.length).toBe(index + 1)
      await expect(cards.nth(1).getByRole('button', { name: 'Edit', exact: true })).toBeDisabled()
      await expect(cards.nth(1).getByRole('button', { name: 'Delete', exact: true })).toBeDisabled()
      await expect(page.locator('.news-create-toggle')).toBeDisabled()
      await expect(form.locator('input').first()).toBeDisabled()
      await cards.nth(1).getByRole('button', { name: 'Edit', exact: true }).evaluate(button => button.click())
      await form.evaluate(element => element.requestSubmit())
      await expect(form.locator('input').first()).toHaveValue('First edited')
      expect(pending).toHaveLength(index + 1)
      await pending[index].fulfill(success
        ? { json: { ok: true, news: { ...stories[0], title: 'First edited' } } }
        : { status: 503, json: { ok: false } })
      if (success) await expect(cards.first().locator('.news-card-title')).toHaveText('First edited')
      else {
        await expect(form.locator('.news-create-error')).toHaveText('Could not update news')
        await expect(form.locator('input').first()).toHaveValue('First edited')
      }
      await expect(cards.nth(1).getByRole('button', { name: 'Edit', exact: true })).toBeEnabled()
    })
  }
  await cards.nth(1).getByRole('button', { name: 'Edit', exact: true }).click()
  await cards.nth(1).locator('.news-edit-form input').first().fill('Second draft')
  await expect(cards.nth(1).locator('.news-edit-form input').first()).toHaveValue('Second draft')
  await expect(page.locator('.news-edit-form')).toHaveCount(1)
})

for (const [action, network] of [['create', false], ['edit', false], ['delete', false], ['create', true]]) {
  test(`${action} news ${network ? 'network' : 'HTTP'} errors use the current language and translate again`, async ({ page }) => {
    let pending
    await page.route(url => url.pathname.startsWith('/api/news'), route => {
      if (route.request().method() === 'GET') return route.fulfill({ json: { ok: true, news: [initialNews] } })
      pending = route
    })
    await page.goto('/tests/e2e/fixtures/fixture.html?news')
    if (action === 'create') {
      await page.locator('.news-create-toggle').click()
      await page.locator('.news-create-form').getByPlaceholder('Title', { exact: true }).fill('Story')
      await page.locator('.news-create-form').getByPlaceholder('News text', { exact: true }).fill('Text')
      await page.locator('.news-create-form [type=submit]').click()
    } else if (action === 'edit') {
      await page.getByRole('button', { name: 'Edit', exact: true }).click()
      await page.locator('.news-edit-form [type=submit]').click()
    } else await page.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect.poll(() => Boolean(pending)).toBe(true)
    await page.getByRole('button', { name: 'Ukrainian', exact: true }).click()
    if (network) await pending.abort('connectionreset')
    else await pending.fulfill({ status: 503, json: { ok: false } })
    const errors = {
      create: ['Не вдалося створити новину', 'Could not create news'],
      edit: ['Не вдалося оновити новину', 'Could not update news'],
      delete: ['Не вдалося видалити новину', 'Could not delete news'],
    }
    await expect(page.locator('.news-create-error')).toHaveText(errors[action][0])
    await page.getByRole('button', { name: 'English', exact: true }).click()
    await expect(page.locator('.news-create-error')).toHaveText(errors[action][1])
  })
}

test('news preserves an explicit server error message across language changes', async ({ page }) => {
  await page.route('**/api/news?*', route => route.fulfill({ json: { ok: true, news: [initialNews] } }))
  await page.route(`**/api/news/${publicId(7)}`, route => route.fulfill({ status: 403, json: { ok: false, error: 'Only admin can delete news' } }))
  await page.goto('/tests/e2e/fixtures/fixture.html?news')
  await page.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(page.locator('.news-create-error')).toHaveText('Only admin can delete news')
  await page.getByRole('button', { name: 'Ukrainian', exact: true }).click()
  await expect(page.locator('.news-create-error')).toHaveText('Only admin can delete news')
})
