import { request } from '../../../shared/api/client.js'
import { toQueryString } from '../../../shared/api/query.js'

export function getInventory(params, options) {
  return request(`/my/inventory?${toQueryString(params)}`, options)
}
