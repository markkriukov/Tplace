import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'

process.env.TELEGRAM_BOT_TOKEN = 'test-bot-token'
const { validateTelegramInitData } = await import('../src/modules/auth/auth-telegram-init-data.validator.js')
const { signToken, verifyToken } = await import('../src/modules/auth/auth-token.signer.js')

test('signed tokens reject changes and expiration', () => {
  const payload = { sub: '100001', pk_user_id: '7', exp: Math.floor(Date.now() / 1000) + 60 }
  const token = signToken(payload)
  assert.deepEqual(verifyToken(token), payload)
  assert.equal(verifyToken(token + 'x'), null)
  assert.equal(verifyToken(signToken({ ...payload, exp: 1 })), null)
})

test('Telegram initData validation preserves signature checks', () => {
  const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: 100001, first_name: 'Test' }) })
  const check = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join('\n')
  const secret = crypto.createHmac('sha256', 'WebAppData').update(process.env.TELEGRAM_BOT_TOKEN).digest()
  params.set('hash', crypto.createHmac('sha256', secret).update(check).digest('hex'))
  assert.equal(validateTelegramInitData(params.toString()).id, 100001)
  params.set('user', JSON.stringify({ id: 999999 }))
  assert.throws(() => validateTelegramInitData(params.toString()))
})

test('initData older than the configured window is rejected', () => {
  const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000) - 601), user: JSON.stringify({ id: 100001 }) })
  const check = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join('\n')
  const secret = crypto.createHmac('sha256', 'WebAppData').update(process.env.TELEGRAM_BOT_TOKEN).digest()
  params.set('hash', crypto.createHmac('sha256', secret).update(check).digest('hex'))
  assert.throws(() => validateTelegramInitData(params.toString()), { statusCode: 401, code: 'INIT_DATA_EXPIRED' })
})
