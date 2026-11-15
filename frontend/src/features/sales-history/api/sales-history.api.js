import { request } from '../../../shared/api/client.js'
import { toQueryString } from '../../../shared/api/query.js'

export function getSalesHistory(params, options) {
  return request(`/market/sales-history?${toQueryString(params)}`, options)
}
