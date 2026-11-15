import { useMemo, useState } from 'react'
import { useFilterCatalog } from './useFilterCatalog.js'
import { buildFilterPayload } from '../lib/filter-search-payload.js'
import { useDebouncedValue } from '../../../shared/hooks/useDebouncedValue.js'

export function useFilterSelection({ enabled = true } = {}) {
  const [selected, setSelected] = useState({ collection: [], model: [], background: [], symbol: [] })
  const [sortOption, setSortOption] = useState('priceAsc')
  const [giftNumberQuery, setGiftNumberQuery] = useState('')
  const [priceMin, setPriceMin] = useState('')
  const [priceMax, setPriceMax] = useState('')

  const filterCatalog = useFilterCatalog({ selected, enabled })
  // Track each input change, even a temporary return to the settled value
  // (number inputs can report an empty value while a decimal is being typed).
  const input = useMemo(() => ({
    query: giftNumberQuery.trim(), minimum: priceMin.trim(), maximum: priceMax.trim(),
  }), [giftNumberQuery, priceMin, priceMax])
  const settledInput = useDebouncedValue(input)
  const { query, minimum, maximum } = settledInput

  const searchCriteriaKey = useMemo(() => JSON.stringify({
    ...buildFilterPayload(selected, filterCatalog),
    ...(query ? { q: query } : {}),
    ...(minimum ? { price_min: minimum } : {}),
    ...(maximum ? { price_max: maximum } : {}),
    ...(sortOption ? { sort: sortOption } : {}),
  }), [selected, filterCatalog, query, minimum, maximum, sortOption])
  return {
    isSearchPending: input !== settledInput,
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
  }
}
