import { request } from '../../../shared/api/client.js'
import { toQueryString } from '../../../shared/api/query.js'

export function getFilters(options) {
  return request('/filters/catalog', options)
}

export function getCollectionFilters({ shortName, regularId }, options) {
  return request(`/filters/catalog/collection?${toQueryString({ collection: shortName, collection_regular_id: regularId })}`, options)
}

export function getFilterCounts(criteria, options) {
  return request(`/filters/counts?${toQueryString(criteria)}`, options)
}
