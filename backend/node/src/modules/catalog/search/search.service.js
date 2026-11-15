import { SEARCH_LIMITS } from '../../../config.js'
import { parseLimit } from '../../../http/pagination.js'
import { parseSearchCriteria } from './search.criteria.js'
import { loadGiftSearchPage } from './search.repository.js'
import { mapGiftToPayload } from '../../gifts/gifts.mapper.js'

export async function searchCatalog({ currentUser, query }) {
  const { page, pagination } = await loadGiftSearchPage({
    limit: parseLimit(query, SEARCH_LIMITS),
    criteria: parseSearchCriteria(query),
    viewerId: currentUser?.pk_user_id ?? null,
  })
  return { payload: { ok: true, gifts: page.map(mapGiftToPayload), pagination } }
}
