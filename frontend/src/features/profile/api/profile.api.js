import { request } from '../../../shared/api/client.js'

export function getProfile(options) {
  return request('/my/profile', options)
}

export function getGiftImport(options) {
  return request('/admin/gift-imports', options)
}

export function createGiftImport(job, options) {
  return request('/admin/gift-imports', { ...options, method: 'POST', body: job })
}
