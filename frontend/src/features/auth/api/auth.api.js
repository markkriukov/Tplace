import { request } from '../../../shared/api/client.js'

export function loginTelegram(initData, options) {
  return request('/auth/telegram', { ...options, method: 'POST', body: { initData } })
}

export function loginDevelopment(user, options) {
  return request('/dev/auth/login', { ...options, method: 'POST', body: user })
}
