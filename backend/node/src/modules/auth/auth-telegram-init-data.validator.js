import crypto from 'node:crypto'
import { createHttpError } from '../../http/errors.js'
import { telegramSettings } from '../../config.js'

function parseJsonParam(params, key) {
  const rawValue = params.get(key)
  if (!rawValue) return null

  try {
    return JSON.parse(rawValue)
  } catch {
    throw createHttpError(400, `Telegram initData field ${key} is invalid JSON`)
  }
}

function buildDataCheckString(params) {
  return [...params.entries()]
    .filter(([key]) => key !== 'hash')
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')
}

function timingSafeEqualHex(leftHex, rightHex) {
  if (!/^[a-f0-9]+$/i.test(leftHex) || !/^[a-f0-9]+$/i.test(rightHex)) return false

  const left = Buffer.from(leftHex, 'hex')
  const right = Buffer.from(rightHex, 'hex')
  if (left.length !== right.length) return false
  return crypto.timingSafeEqual(left, right)
}

/** Verifies the Mini App's signed initData and returns its Telegram user. */
export function validateTelegramInitData(rawInitData) {
  const { botToken, initDataMaxAgeSeconds } = telegramSettings()
  if (!botToken) {
    throw createHttpError(500, 'TELEGRAM_BOT_TOKEN is not configured')
  }

  if (typeof rawInitData !== 'string' || !rawInitData.trim()) {
    throw createHttpError(400, 'Field initData is required')
  }

  const params = new URLSearchParams(rawInitData)
  const receivedHash = params.get('hash') ?? ''
  if (!receivedHash) {
    throw createHttpError(403, 'Telegram initData hash is missing')
  }

  const authDate = Number.parseInt(params.get('auth_date') ?? '', 10)
  if (!Number.isInteger(authDate) || authDate <= 0) {
    throw createHttpError(403, 'Telegram initData auth_date is invalid')
  }

  const ageSeconds = Math.floor(Date.now() / 1000) - authDate
  // Allow small clock skew between Telegram and this server.
  if (ageSeconds < -30 || ageSeconds > initDataMaxAgeSeconds) {
    throw createHttpError(401, 'Telegram initData is expired', 'INIT_DATA_EXPIRED')
  }

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest()
  const expectedHash = crypto.createHmac('sha256', secretKey).update(buildDataCheckString(params)).digest('hex')
  if (!timingSafeEqualHex(receivedHash, expectedHash)) {
    throw createHttpError(403, 'Telegram initData hash is invalid')
  }

  const user = parseJsonParam(params, 'user')
  const telegramId = user?.id == null ? '' : String(user.id).trim()
  if (!/^\d+$/.test(telegramId)) {
    throw createHttpError(403, 'Telegram initData user is missing')
  }
  return user
}
