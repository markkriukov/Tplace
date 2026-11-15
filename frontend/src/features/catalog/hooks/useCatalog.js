import { useState, useRef, useEffect, useCallback } from 'react'
import { useInfiniteScroll } from '../../../shared/hooks/useInfiniteScroll.js'
import { searchCatalog } from '../api/catalog.api.js'
import {
  createInitialPagination,
  mapGiftCard,
  normalizePaginationPayload,
  mergeGiftPages,
} from '../../gifts/lib/gift-utils.js'
import { SEARCH_PAGE_SIZE } from '../../gifts/config/gift-config.js'

export function useCatalog({
  authToken,
  searchCriteriaKey,
  isCatalogView,
  isSearchPending = false,
}) {
  const [catalogGifts, setCatalogGifts] = useState([])
  const [hasLoadedCatalogGifts, setHasLoadedCatalogGifts] = useState(false)
  const [isCatalogLoading, setIsCatalogLoading] = useState(false)
  const [isAppending, setIsAppending] = useState(false)
  // The criteria of the gifts shown; a load for other criteria is a new search.
  const [loadedCriteriaKey, setLoadedCriteriaKey] = useState(null)
  const [catalogPagination, setCatalogPagination] = useState(() => createInitialPagination(SEARCH_PAGE_SIZE))
  const [catalogError, setCatalogError] = useState(null)
  const failedPage = useRef(null)
  const activeRequest = useRef(null)
  const loadCatalogPage = useCallback(async ({ cursor = null, append = false } = {}) => {
    if (isSearchPending) return
    activeRequest.current?.abort()
    const controller = new AbortController()
    activeRequest.current = controller
    const signal = controller.signal
    setIsCatalogLoading(true)
    setIsAppending(append)
    setCatalogError(null)
    try {
      const response = await searchCatalog(
        { limit: SEARCH_PAGE_SIZE, cursor, ...JSON.parse(searchCriteriaKey) },
        { token: authToken, signal },
      )
      if (signal.aborted) return
      if (!response.ok) throw new Error(response.data?.code ?? 'REQUEST_FAILED')

      const payload = response.data
      if (!payload?.ok || !Array.isArray(payload.gifts)) throw new Error('INVALID_RESPONSE')

      const nextPageGifts = payload.gifts.map(mapGiftCard)
      setCatalogPagination(normalizePaginationPayload(payload.pagination, SEARCH_PAGE_SIZE))
      setCatalogGifts((prev) => (append ? mergeGiftPages(prev, nextPageGifts) : nextPageGifts))
      setLoadedCriteriaKey(searchCriteriaKey)
      setHasLoadedCatalogGifts(true)
      failedPage.current = null
    } catch (error) {
      if (controller.signal.aborted) return
      failedPage.current = { cursor, append }
      setCatalogError(error.message)
    } finally {
      if (activeRequest.current === controller) activeRequest.current = null
      if (!controller.signal.aborted) setIsCatalogLoading(false)
    }
  }, [authToken, searchCriteriaKey, isSearchPending])

  useEffect(() => {
    if (!isCatalogView || isSearchPending) return

    // eslint-disable-next-line react-hooks/set-state-in-effect -- Start the request and its loading state together.
    loadCatalogPage()
    return () => activeRequest.current?.abort()
  }, [isCatalogView, isSearchPending, loadCatalogPage])

  const catalogLoadTriggerRef = useInfiniteScroll({
    enabled: isCatalogView && !isSearchPending && !isCatalogLoading && !catalogError,
    pagination: catalogPagination,
    loadPage: loadCatalogPage,
  })
  const retryCatalog = () => loadCatalogPage(failedPage.current ?? {})
  return {
    refreshCatalog: () => { if (isCatalogView) void loadCatalogPage() },
    catalogError,
    retryCatalog,
    catalogGifts,
    setCatalogGifts,
    hasLoadedCatalogGifts,
    isCatalogLoading: isCatalogLoading || isSearchPending,
    // Shown gifts belong to the previous criteria; a refresh of the same criteria is silent.
    isCatalogSearching: isSearchPending || (isCatalogLoading && hasLoadedCatalogGifts && loadedCriteriaKey !== searchCriteriaKey),
    isCatalogLoadingMore: isCatalogLoading && isAppending && !isSearchPending,
    catalogPagination,
    catalogLoadTriggerRef,
  }
}
