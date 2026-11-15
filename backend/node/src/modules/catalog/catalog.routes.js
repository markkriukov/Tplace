import { getCollectionFilters, getFilterCounts, getFilters } from './filters/filters.service.js'
import { getMarketConfig } from './catalog-market-config.service.js'
import { listSales } from './sales-history/sales-history.service.js'
import { searchCatalog } from './search/search.service.js'

// Counts and sales change with every trade, so those reads always revalidate (ETag).
// Signed-in viewers see their own gifts marked in search; only anonymous
// results may be reused, briefly.
export const routeCatalog = [
  { method: 'GET', path: '/filters/catalog/collection', handler: getCollectionFilters, auth: 'none', query: 'filters', cache: 'public, no-cache' },
  { method: 'GET', path: '/filters/catalog', handler: getFilters, auth: 'none', cache: 'public, no-cache' },
  { method: 'GET', path: '/filters/counts', handler: getFilterCounts, auth: 'none', query: 'filterCounts', cache: 'public, no-cache' },
  { method: 'GET', path: '/market/config', handler: getMarketConfig, auth: 'none', cache: 'public, max-age=300' },
  { method: 'GET', path: '/market/sales-history', handler: listSales, auth: 'none', query: 'salesHistory', cache: 'public, no-cache' },
  { method: 'GET', path: '/search', handler: searchCatalog, auth: 'optional', query: 'search',
    cache: ({ currentUser }) => currentUser ? null : 'public, max-age=5' },
]
