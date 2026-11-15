import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { getSalesHistory } from '../api/sales-history.api.js'
import SalesHistoryOverlay from './SalesHistoryOverlay.jsx'
import { mapSalesHistoryItem } from '../lib/sales-history-utils.js'
import { useTranslation } from '../../../shared/i18n/useTranslation.js'
import { useFilterCatalog } from '../../filters/hooks/useFilterCatalog.js'
import { useGiftFilters } from '../../filters/hooks/useGiftFilters.js'
import { filterGroups } from '../../gifts/config/gift-config.js'

const SALES_HISTORY_PAGE_SIZE = 20

const createInitialSelection = () => ({ collection: [], model: [], background: [], symbol: [] })

/** Query parameters of one sales history page for the given criteria. */
const historyParams = (criteria, cursor) => ({
  limit: SALES_HISTORY_PAGE_SIZE,
  cursor,
  q: criteria.q,
  ...Object.fromEntries(filterGroups.map(({ key }) => [key, criteria.selected[key]])),
  price_min: criteria.priceMin,
  price_max: criteria.priceMax,
  sort: criteria.sort,
})

const SalesHistoryFlow = forwardRef(function SalesHistoryFlow(_props, ref) {
  const { language, t } = useTranslation()
  const [isOpen, setIsOpen] = useState(false)
  const [items, setItems] = useState([])
  const [selected, setSelected] = useState(createInitialSelection)
  const [giftNumberQuery, setGiftNumberQuery] = useState('')
  const [priceMin, setPriceMin] = useState('')
  const [priceMax, setPriceMax] = useState('')
  const [sortOption, setSortOption] = useState('soldDesc')
  const [pagination, setPagination] = useState({ hasMore: false, nextCursor: null, criteriaKey: null })
  const [hasLoadedHistory, setHasLoadedHistory] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const loadMoreController = useRef(null)
  const failedPage = useRef(null)

  const localizedFilterGroups = useMemo(
    () => filterGroups.map((group) => ({ ...group, label: t(`filters.${group.key}`) })),
    [t]
  )
  const sortOptions = useMemo(() => [
    { id: 'soldDesc', label: t('sales.sort.newest') },
    { id: 'soldAsc', label: t('sales.sort.oldest') },
    { id: 'priceAsc', label: t('filters.sort.priceAsc') },
    { id: 'priceDesc', label: t('filters.sort.priceDesc') },
  ], [t])
  const filterCatalog = useFilterCatalog({ selected, enabled: isOpen })
  const historyGifts = useMemo(() => items.map((item) => ({
    collection_name: item.collectionName,
    model: item.modelName,
    background: item.backgroundName,
    symbol: item.symbolName,
  })), [items])
  const giftFilters = useGiftFilters({ selected, gifts: historyGifts, setSelected, t, filterCatalog })
  const criteriaKey = JSON.stringify({ selected, q: giftNumberQuery.trim(), priceMin: priceMin.trim(), priceMax: priceMax.trim(), sort: sortOption })

  const filters = {
    ...giftFilters,
    filterGroups: localizedFilterGroups,
    selected,
    giftNumberQuery, setGiftNumberQuery,
    sortOptions, sortOption, setSortOption,
    priceMin, setPriceMin,
    priceMax, setPriceMax,
  }

  const loadSalesHistory = async ({ append = false, cursor = null, signal = undefined, criteria = JSON.parse(criteriaKey) } = {}) => {
    if (append) {
      setIsLoadingMore(true)
    } else {
      setIsLoading(true)
      setIsLoadingMore(false)
      setPagination({ hasMore: false, nextCursor: null, criteriaKey: null })
    }
    setError('')

    try {
      const response = await getSalesHistory(historyParams(criteria, cursor), { signal })
      if (signal?.aborted) return
      if (!response.ok || !Array.isArray(response.data?.items)) throw new Error('Invalid sales history response')

      const payload = response.data
      const mapped = payload.items.map((item) => mapSalesHistoryItem(item, language)).filter((item) => Boolean(item.id))
      setHasLoadedHistory(true)
      failedPage.current = null
      setItems((prev) => (append ? [...prev, ...mapped] : mapped))
      setPagination({
        hasMore: payload.pagination?.has_more === true,
        criteriaKey: JSON.stringify(criteria),
        nextCursor: typeof payload.pagination?.next_cursor === 'string' && payload.pagination.next_cursor
          ? payload.pagination.next_cursor
          : null,
      })
    } catch {
      if (signal?.aborted) return
      failedPage.current = { append, cursor, criteria }
      setError(t('sales.loadFailed'))
    } finally {
      if (!signal?.aborted) {
        setIsLoading(false)
        setIsLoadingMore(false)
      }
    }
  }

  useImperativeHandle(ref, () => ({ open: () => setIsOpen(true) }), [])

  useEffect(() => {
    if (!isOpen) return undefined
    const controller = new AbortController()
    const timer = setTimeout(() => {
      loadSalesHistory({ signal: controller.signal, criteria: JSON.parse(criteriaKey) })
    }, hasLoadedHistory ? 250 : 0)

    return () => {
      clearTimeout(timer)
      controller.abort()
      loadMoreController.current?.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, criteriaKey])

  const loadMore = () => {
    if (!pagination.hasMore || !pagination.nextCursor || pagination.criteriaKey !== criteriaKey || isLoading || isLoadingMore) return
    const controller = new AbortController()
    loadMoreController.current = controller
    loadSalesHistory({ append: true, cursor: pagination.nextCursor, signal: controller.signal })
  }

  const retry = () => {
    if (isLoading || isLoadingMore) return
    loadMoreController.current?.abort()
    const controller = new AbortController()
    loadMoreController.current = controller
    void loadSalesHistory({ ...failedPage.current, signal: controller.signal })
  }

  return (
    <SalesHistoryOverlay
      isOpen={isOpen}
      onClose={() => setIsOpen(false)}
      items={items}
      filters={filters}
      onLoadMore={loadMore}
      hasMore={pagination.hasMore}
      isLoading={isLoading}
      hasLoadedHistory={hasLoadedHistory}
      isLoadingMore={isLoadingMore}
      error={error}
      onRetry={retry}
    />
  )
})

export default SalesHistoryFlow
