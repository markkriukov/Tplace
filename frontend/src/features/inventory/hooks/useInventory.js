import { useCallback, useEffect, useRef, useState } from 'react'
import { useInfiniteScroll } from '../../../shared/hooks/useInfiniteScroll.js'
import { getInventory } from '../api/inventory.api.js'
import { createInitialPagination, mapGiftCard, mergeGiftPages, normalizePaginationPayload } from '../../gifts/lib/gift-utils.js'
import { INVENTORY_PAGE_SIZE } from '../../gifts/config/gift-config.js'

// The UI names inventory sections onSale and notOnSale.
const mapSummary = (summary) => summary && { onSale: summary.on_sale, notOnSale: summary.not_on_sale }

// The server's default cap on an inventory page; a refresh follows cursors past a lower one.
const REFRESH_BATCH_LIMIT = Math.max(INVENTORY_PAGE_SIZE, 100)

const emptyState = (key, authToken, summary = null) => ({
  key, authToken, gifts: [], summary, loaded: false, loading: false, refreshing: false, error: null,
  pagination: createInitialPagination(INVENTORY_PAGE_SIZE), failedPage: null,
})

export function useInventory({ authToken, searchCriteriaKey, isInventoryView, isSearchPending = false }) {
  const [inventorySection, setInventorySection] = useState('onSale')
  const [revision, setRevision] = useState(0)
  const key = JSON.stringify([authToken, inventorySection, searchCriteriaKey])
  const [state, setState] = useState(() => emptyState(key, authToken))
  // Reset before children render, including when logged out or on another page.
  // Merely masking old data would let it reappear when the same account returns.
  // Summary covers all sections and is independent of search criteria.
  const data = state.key === key ? state : emptyState(
    key, authToken, state.authToken === authToken ? state.summary : null
  )
  if (state.key !== key) setState(data)
  const activeRequest = useRef(null)
  // The token whose summary is current. Filter and section changes keep it, so
  // their first pages ask the server to skip the summary; refreshes clear it.
  const summaryToken = useRef(null)
  // How many gifts a refresh must reload; null until the first page arrives.
  const shownCount = useRef(null)
  useEffect(() => {
    shownCount.current = data.loaded ? data.gifts.length : null
  })
  const update = useCallback((patch) => setState(previous => {
    if (previous.key !== key) return previous
    return { ...previous, ...(typeof patch === 'function' ? patch(previous) : patch) }
  }), [key])

  const loadInventoryPage = useCallback(async ({ cursor = null, append = false } = {}) => {
    if (!authToken || isSearchPending) return
    activeRequest.current?.abort()
    const controller = new AbortController()
    activeRequest.current = controller
    const { signal } = controller
    // A refresh reloads every gift already shown and replaces the list in one
    // update, so the grid neither shrinks to one page nor refills page by page.
    const refreshCount = append ? null : shownCount.current
    update(refreshCount === null ? { loading: true, error: null } : { refreshing: true, error: null })
    const keepSummary = Boolean(cursor) || summaryToken.current === authToken
    const fetchPage = async (pageCursor, limit, withSummary) => {
      const response = await getInventory({
        ...JSON.parse(searchCriteriaKey), listed: inventorySection === 'onSale',
        limit, cursor: pageCursor, ...(withSummary ? {} : { summary: false }),
      }, { token: authToken, signal })
      if (!response.ok) throw new Error(response.data?.code ?? 'REQUEST_FAILED')
      if (!response.data?.ok || !Array.isArray(response.data.gifts)) throw new Error('INVALID_RESPONSE')
      return response.data
    }
    try {
      const target = Math.max(refreshCount ?? 0, INVENTORY_PAGE_SIZE)
      let payload = await fetchPage(cursor, Math.min(target, REFRESH_BATCH_LIMIT), !keepSummary)
      const summary = payload.inventory_summary
      let gifts = payload.gifts.map(mapGiftCard)
      while (refreshCount !== null && gifts.length < target && payload.gifts.length && payload.pagination?.has_more) {
        payload = await fetchPage(payload.pagination.next_cursor, Math.min(target - gifts.length, REFRESH_BATCH_LIMIT), false)
        gifts = mergeGiftPages(gifts, payload.gifts.map(mapGiftCard))
      }
      if (signal.aborted) return
      if (summary) summaryToken.current = authToken
      update(previous => ({
        gifts: append ? mergeGiftPages(previous.gifts, gifts) : gifts,
        summary: mapSummary(summary) ?? previous.summary, loaded: true, failedPage: null,
        pagination: normalizePaginationPayload(payload.pagination, INVENTORY_PAGE_SIZE),
      }))
    } catch (error) {
      if (!signal.aborted) update({ error: error.message, failedPage: { cursor, append } })
    } finally {
      if (activeRequest.current === controller) activeRequest.current = null
      if (!signal.aborted) update({ loading: false, refreshing: false })
    }
  }, [authToken, searchCriteriaKey, inventorySection, update, isSearchPending])

  useEffect(() => {
    // Cancellation also covers pagination requests started by the observer.
    if (isInventoryView && authToken) void loadInventoryPage()
    return () => activeRequest.current?.abort()
  }, [isInventoryView, authToken, revision, loadInventoryPage])

  useEffect(() => {
    if (!isInventoryView || !authToken) return
    const refresh = () => {
      if (document.visibilityState === 'hidden' || activeRequest.current) return
      summaryToken.current = null
      void loadInventoryPage()
    }
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [isInventoryView, authToken, loadInventoryPage])

  const inventoryLoadTriggerRef = useInfiniteScroll({
    enabled: isInventoryView && !isSearchPending && Boolean(authToken) && data.loaded && !data.loading && !data.refreshing && !data.error,
    pagination: data.pagination, loadPage: loadInventoryPage,
  })
  return {
    inventoryError: data.error,
    retryInventory: () => loadInventoryPage(data.failedPage ?? {}),
    inventorySection, setInventorySection,
    inventorySummary: data.summary,
    refreshInventory: () => {
      summaryToken.current = null
      setRevision(value => value + 1)
    },
    inventoryGifts: data.gifts,
    setInventoryGifts: value => update(previous => ({ gifts: typeof value === 'function' ? value(previous.gifts) : value })),
    hasLoadedInventoryGifts: data.loaded,
    isInventoryLoading: data.loading || isSearchPending,
    // New criteria reset the rows, so only typed input still shows the previous search.
    isInventorySearching: isSearchPending,
    // A refresh sets `refreshing`, so loading over shown rows is the next page.
    isInventoryLoadingMore: data.loading && data.loaded && !isSearchPending,
    inventoryPagination: data.pagination,
    inventoryLoadTriggerRef,
  }
}
