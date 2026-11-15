import { test, expect } from '@playwright/test'

test('admin submits username and limit, sees progress and restores status after reload', async ({ page }) => {
  let job = null
  let submissions = 0
  let pending
  await page.route('**/api/admin/gift-imports', route => {
    expect(route.request().headers().authorization).toBe('Bearer admin-one')
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON()
      expect(body.username).toBe('exampleuser')
      expect(body.max_count).toBe(7)
      expect(body.request_key).toMatch(/^[a-zA-Z0-9_-]+$/)
      submissions += 1
      job = { id: '1', username: body.username, status: 'queued' }
      pending = route
      return
    }
    return route.fulfill({ json: { ok: true, job } })
  })
  await page.goto('/tests/e2e/fixtures/fixture.html?import')
  const form = page.getByRole('form', { name: 'Add gifts' })
  const submit = form.getByRole('button', { name: 'Add gifts' })
  await expect(submit).toBeEnabled()
  await form.getByLabel('Telegram username').fill('@ExampleUser')
  await form.getByLabel('Maximum gifts (1–1000)').fill('7')
  await submit.click()
  await expect(submit).toBeDisabled()
  await expect.poll(() => submissions).toBe(1)
  await pending.fulfill({ status: 202, json: { ok: true, job } })
  await expect(form.getByRole('status')).toContainText('Waiting to import')
  job = { ...job, status: 'running' }
  await expect(form.getByRole('status')).toContainText('Importing gifts')
  job = { ...job, status: 'completed', result: { fetched: 7, added: 5, skipped: 2 } }
  await expect(form.getByRole('status')).toContainText('Read: 7. Added: 5. Skipped: 2.')
  await expect(page.getByLabel('Import refreshes')).toHaveText('1')
  await expect(submit).toBeEnabled()
  await page.reload()
  await expect(form.getByRole('status')).toContainText('Import completed')
  expect(submissions).toBe(1)
})

test('ordinary users have no import form; an account switch hides previous results', async ({ page }) => {
  await page.goto('/tests/e2e/fixtures/fixture.html?import&ordinary')
  await expect(page.getByRole('form', { name: 'Add gifts' })).toHaveCount(0)
  await page.route('**/api/admin/gift-imports', route => route.fulfill({ json: { ok: true, job:
    route.request().headers().authorization === 'Bearer admin-one'
      ? { id: '1', username: 'firstadmin', status: 'completed', result: { fetched: 2, added: 2, skipped: 0 } } : null,
  } }))
  await page.goto('/tests/e2e/fixtures/fixture.html?import')
  await expect(page.getByRole('form').getByRole('status')).toContainText('@firstadmin')
  await page.getByRole('button', { name: 'Switch import account' }).click()
  await expect(page.getByRole('form').getByRole('status')).toHaveCount(0)
})

test('failed job explains the failure and permits another request', async ({ page }) => {
  await page.route('**/api/admin/gift-imports', route => route.fulfill({ json: { ok: true,
    job: { id: '2', username: 'missinguser', status: 'failed', error_code: 'TELEGRAM_USER_NOT_FOUND' },
  } }))
  await page.goto('/tests/e2e/fixtures/fixture.html?import')
  await expect(page.getByRole('form').getByRole('status')).toContainText('Telegram user not found or unavailable.')
  await expect(page.getByRole('button', { name: 'Add gifts', exact: true })).toBeEnabled()
})
