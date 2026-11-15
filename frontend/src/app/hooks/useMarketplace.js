import { useMemo } from 'react'
import { createMarketActions } from '../lib/market-actions.js'
import { filterGroups, sortOptions } from '../../features/gifts/config/gift-config.js'
import { useFilterSelection } from '../../features/filters/hooks/useFilterSelection.js'
import { useGiftFilters } from '../../features/filters/hooks/useGiftFilters.js'
import { useFilterCounts } from '../../features/filters/hooks/useFilterCounts.js'
import { useCart } from '../../features/cart/hooks/useCart.js'
import { useCatalog } from '../../features/catalog/hooks/useCatalog.js'
import { useInventory } from '../../features/inventory/hooks/useInventory.js'
import { getInventoryFilterCounts } from '../../features/inventory/lib/inventory-counts.js'
import { useGiftMarketPricing } from '../../features/gifts/hooks/useGiftMarketPricing.js'
import { trimText } from '../../features/gifts/lib/gift-utils.js'

const FILTER_KEYS = ['collection', 'model', 'background', 'symbol']

export function useMarketplace({ isCatalogView, isInventoryView, authToken, t }) {
  const {
    selected,
    filterCatalog,
    searchCriteriaKey,
    setSelected,
    sortOption,
    setSortOption,
    giftNumberQuery,
    setGiftNumberQuery,
    priceMin,
    setPriceMin,
    priceMax,
    setPriceMax,
    isSearchPending,
  } = useFilterSelection({ enabled: isCatalogView || isInventoryView })

  const localizedFilterGroups = useMemo(
    () => filterGroups.map((group) => ({ ...group, label: t(`filters.${group.key}`) })),
    [t]
  )

  const localizedSortOptions = useMemo(
    () => sortOptions.map((option) => ({ ...option, label: t(`filters.sort.${option.id}`) })),
    [t]
  )

  const {
    catalogGifts,
    setCatalogGifts,
    hasLoadedCatalogGifts,
    isCatalogLoading,
    isCatalogSearching,
    isCatalogLoadingMore,
    catalogPagination,
    catalogLoadTriggerRef,
    catalogError,
    retryCatalog,
    refreshCatalog,
  } = useCatalog({ authToken, searchCriteriaKey, isCatalogView, isSearchPending })

  const {
    inventorySection,
    setInventorySection,
    inventorySummary,
    refreshInventory,
    inventoryGifts,
    setInventoryGifts,
    hasLoadedInventoryGifts,
    isInventoryLoading,
    isInventorySearching,
    isInventoryLoadingMore,
    inventoryPagination,
    inventoryLoadTriggerRef,
    inventoryError,
    retryInventory,
  } = useInventory({ authToken, searchCriteriaKey, isInventoryView, isSearchPending })

  const pricing = useGiftMarketPricing()

  // The gifts of the visible page, once its first page has loaded.
  const gifts = useMemo(() => {
    if (isCatalogView) return hasLoadedCatalogGifts ? catalogGifts : []
    return isInventoryView && hasLoadedInventoryGifts ? inventoryGifts : []
  }, [isCatalogView, hasLoadedCatalogGifts, catalogGifts, isInventoryView, hasLoadedInventoryGifts, inventoryGifts])

  const inventoryFilterCounts = useMemo(
    () => isInventoryView
      ? getInventoryFilterCounts(inventorySummary?.[inventorySection], selected)
      : null,
    [isInventoryView, inventorySummary, inventorySection, selected]
  )

  const catalogFilterCounts = useFilterCounts({ searchCriteriaKey, enabled: isCatalogView })

  const {
    optionsByGroup,
    toggleFilterValue,
    clearFilter,
    isAllSelected,
    toggleSelectAll,
    getFilterSummary,
    handleHorizontalWheel,
  } = useGiftFilters({
    selected, gifts, setSelected, t, filterCatalog,
    quantityCounts: inventoryFilterCounts, onSaleCounts: isCatalogView ? catalogFilterCounts : null,
  })

  const { cartIds, setCartIds, cartGifts } = useCart({ authToken, gifts, catalogGifts, inventoryGifts })

  /** Shows the catalog filtered by one attribute of a gift, within its collection. */
  const filterCatalogByGiftAttribute = (gift, key) => {
    const collection = trimText(gift?.collection_name)
    const value = key === 'collection' ? collection : trimText(gift?.[key])
    if (!FILTER_KEYS.includes(key) || !collection || !value) return false

    setSelected(Object.fromEntries(FILTER_KEYS.map((filterKey) => [
      filterKey, filterKey === 'collection' ? [collection] : filterKey === key ? [value] : [],
    ])))
    setGiftNumberQuery('')
    setPriceMin('')
    setPriceMax('')
    return true
  }

  const actions = createMarketActions({ setCatalogGifts, setInventoryGifts, setCartIds, refreshInventory, refreshCatalog })
  return {
    pricing,
    filters: {
      filterGroups: localizedFilterGroups,
      sortOptions: localizedSortOptions,
      selected,
      optionsByGroup,
      isAllSelected,
      toggleSelectAll,
      toggleFilterValue,
      clearFilter,
      getFilterSummary,
      giftNumberQuery,
      setGiftNumberQuery,
      sortOption,
      setSortOption,
      priceMin,
      setPriceMin,
      priceMax,
      setPriceMax,
      handleHorizontalWheel,
    },
    catalog: {
      gifts,
      isLoading: isCatalogLoading,
      isSearching: isCatalogSearching,
      isLoadingMore: isCatalogLoadingMore,
      hasLoadedGifts: hasLoadedCatalogGifts,
      pagination: catalogPagination,
      loadTriggerRef: catalogLoadTriggerRef,
      error: catalogError,
      retry: retryCatalog,
    },
    inventory: {
      gifts,
      isLoading: isInventoryLoading,
      isSearching: isInventorySearching,
      isLoadingMore: isInventoryLoadingMore,
      hasLoadedGifts: hasLoadedInventoryGifts,
      pagination: inventoryPagination,
      loadTriggerRef: inventoryLoadTriggerRef,
      error: inventoryError,
      retry: retryInventory,
      inventorySection,
      setInventorySection,
      inventorySummary,
      refreshInventory,
    },
    cart: { cartIds, setCartIds, cartGifts },
    filterCatalogByGiftAttribute,
    actions,
  }
}
