import { loginTelegram, loginDevelopment } from './auth.service.js'
import { devAuthAllowed } from '../../security.js'

export const routeAuth = [
  { method: 'POST', path: '/auth/telegram', handler: loginTelegram, auth: 'none', body: 'loginTelegram' },
  ...(devAuthAllowed()
    ? [{ method: 'POST', path: '/dev/auth/login', handler: loginDevelopment, auth: 'none', body: 'loginDevelopment' }] : []),
]
