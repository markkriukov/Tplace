import { useEffect, useMemo, useState } from 'react'
import { getFilterCounts } from '../api/filters.api.js'
import { useFilterRefreshRevision } from './useFilterRefreshRevision.js'

/**
 * On-sale quantities by catalog ID for each filter group within the current
 * search, so an option shows the results choosing it adds. Null until loaded;
 * a change of criteria keeps the previous counts until the new ones arrive.
 */
export function useFilterCounts({ searchCriteriaKey, enabled }) {
  const [counts, setCounts] = useState(null)
  const revision = useFilterRefreshRevision(enabled)
  // The order of results does not change the counts.
  const countsKey = useMemo(() => {
    const criteria = JSON.parse(searchCriteriaKey)
    delete criteria.sort
    return JSON.stringify(criteria)
  }, [searchCriteriaKey])

  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    getFilterCounts(JSON.parse(countsKey), { signal: controller.signal }).then((response) => {
      const loaded = response.data?.counts
      if (response.ok && loaded && typeof loaded === 'object') setCounts(loaded)
    }).catch(() => { /* Keep the last counts until a refresh succeeds. */ })
    return () => controller.abort()
  }, [enabled, countsKey, revision])
  return counts
}
