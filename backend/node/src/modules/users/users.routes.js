import { getProfile } from './users.service.js'

export const routeUsers = [
  { method: 'GET', path: '/my/profile', handler: getProfile, auth: 'required' },
]
