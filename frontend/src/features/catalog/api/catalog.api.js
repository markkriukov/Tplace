import { request } from '../../../shared/api/client.js'
import { toQueryString } from '../../../shared/api/query.js'

export function searchCatalog(params, options) {
  return request(`/search?${toQueryString(params)}`, options)
}
