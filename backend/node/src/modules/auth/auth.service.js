import { authSettings } from '../../security.js'
import { createHttpError } from '../../http/errors.js'
import { validateTelegramInitData } from './auth-telegram-init-data.validator.js'
import { User } from '../../db/models.js'
import { buildAuthPayload } from './auth.mapper.js'

const optionalName = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null)

async function signIn(telegramUser, method) {
  const [user] = await User.upsert(
    { telegram_id: String(telegramUser.id), username: optionalName(telegramUser.username), first_name: optionalName(telegramUser.first_name) },
    { returning: true, fields: ['telegram_id', 'username', 'first_name'] }
  )
  return { payload: buildAuthPayload(user, method) }
}

export async function loginTelegram({ body }) {
  return signIn(validateTelegramInitData(body.initData), 'telegram')
}

// The request schema requires a numeric Telegram user ID.
export async function loginDevelopment({ body }) {
  if (!authSettings().allowDevAuth) throw createHttpError(404, 'Endpoint not found', 'NOT_FOUND')
  return signIn(body, 'dev')
}
