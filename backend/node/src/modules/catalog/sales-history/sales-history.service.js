import { SALES_HISTORY_LIMITS } from '../../../config.js'
import { parseLimit } from '../../../http/pagination.js'
import { parseSearchCriteria } from '../search/search.criteria.js'
import { loadSalesHistoryPage } from './sales-history.repository.js'
import { mapSalesHistoryPayload } from './sales-history.mapper.js'

export async function listSales({ query }) {
  const { page, pagination } = await loadSalesHistoryPage({
    limit: parseLimit(query, SALES_HISTORY_LIMITS),
    criteria: parseSearchCriteria(query),
    sort: query.get('sort') ?? 'soldDesc',
  })
  return { payload: { ok: true, items: page.map(mapSalesHistoryPayload), pagination } }
}
