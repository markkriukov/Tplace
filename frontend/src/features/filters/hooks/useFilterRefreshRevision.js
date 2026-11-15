import { useEffect, useState } from 'react'
import { marketEvents } from '../../../shared/api/market-events.js'
import { FILTER_CATALOG_TTL_MS } from '../lib/filter-catalog-cache.js'

/** Advances whenever on-sale quantities may have changed: periodically, on return to the app and after a trade. */
export function useFilterRefreshRevision(enabled) {
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    if (!enabled) return
    const refresh = () => {
      if (document.visibilityState !== 'hidden') setRevision(value => value + 1)
    }
    const timer = setInterval(refresh, FILTER_CATALOG_TTL_MS)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    marketEvents.addEventListener('change', refresh)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
      marketEvents.removeEventListener('change', refresh)
    }
  }, [enabled])
  return revision
}
