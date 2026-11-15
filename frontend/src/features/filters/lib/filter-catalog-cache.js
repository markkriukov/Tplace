import { marketEvents } from '../../../shared/api/market-events.js'
import { getFilters, getCollectionFilters } from '../api/filters.api.js'
import { mapFilterCatalog } from './filter-catalog-mapping.js'

export const FILTER_CATALOG_TTL_MS = 30_000
const cache = new Map()

marketEvents.addEventListener('change', () => {
  for (const entry of cache.values()) entry.controller.abort()
  cache.clear()
})

export function loadFilterCatalog(collection = null) {
  const key = JSON.stringify(collection)
  const existing = cache.get(key)
  if (existing && existing.expiresAt > Date.now()) return existing.promise
  const controller = new AbortController()
  const entry = { controller, expiresAt: Date.now() + FILTER_CATALOG_TTL_MS }
  const options = { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) }
  entry.promise = Promise.resolve().then(async () => {
    const response = collection ? await getCollectionFilters(collection, options) : await getFilters(options)
    if (controller.signal.aborted) throw new DOMException('Invalidated filter catalog', 'AbortError')
    if (!response.ok || response.data?.ok !== true) throw new Error('Filters unavailable')
    return mapFilterCatalog(response.data)
  }).catch(error => {
    if (cache.get(key) === entry) cache.delete(key)
    throw error
  })
  cache.set(key, entry)
  if (cache.size > 200) cache.delete(cache.keys().next().value)
  return entry.promise
}
