import { useMemo, useCallback, useEffect } from 'react'
import { normalizeFilterValue, trimText, formatRarityValue } from '../../gifts/lib/gift-utils.js'
import { filterGroups } from '../../gifts/config/gift-config.js'

const groupIcons = { collection: '\u{1F381}', model: '\u{1F381}', background: '\u{1F3A8}', symbol: '\u2728' }

/** The preview beside a filter option: catalog artwork, or the backdrop colors. */
function optionPreview(groupKey, item, value) {
  if (groupKey === 'background') {
    return { previewType: 'color', colorCenter: item.centerColor, colorEdge: item.edgeColor, colorPattern: item.patternColor, previewTitle: value }
  }
  const url = trimText(groupKey === 'collection' ? item.photoUrl : item.url)
  return url ? { previewType: 'image', previewUrl: url, previewTitle: value, previewVariant: groupKey } : {}
}

/**
 * quantityCounts (by normalized value) replace the catalog quantities; onSaleCounts
 * (by catalog ID) replace only their on-sale counts, keeping the catalog's options.
 */
export function useGiftFilters({ selected, gifts, setSelected, t, filterCatalog, quantityCounts = null, onSaleCounts = null }) {
  const {
    filtersCatalog,
    collectionScopedFilters,
    hasLoadedFiltersCatalog,
    selectedCollectionShortNames,
    activeCollectionShortName,
  } = filterCatalog

  const selectedValuesByGroup = useMemo(
    () => Object.fromEntries(filterGroups.map(({ key }) => [key, new Set(selected[key])])),
    [selected]
  )

  const collectionDisplayNormalizedByAlias = useMemo(() => {
    const byAlias = new Map()
    for (const collection of filtersCatalog.collections) {
      const shortNameNormalized = normalizeFilterValue(collection?.shortName)
      const displayNameNormalized = normalizeFilterValue(collection?.name)
      if (!displayNameNormalized) continue
      byAlias.set(displayNameNormalized, displayNameNormalized)
      if (shortNameNormalized) byAlias.set(shortNameNormalized, displayNameNormalized)
    }
    return byAlias
  }, [filtersCatalog])

  const resolveGiftCollectionNormalized = useCallback((gift) => {
    const normalized = normalizeFilterValue(gift.collection_name)
    return collectionDisplayNormalizedByAlias.get(normalized) || normalized
  }, [collectionDisplayNormalizedByAlias])

  const { countsByGroup, valuesByGroup } = useMemo(() => {
    const countsByGroup = Object.fromEntries(filterGroups.map(({ key }) => [key, Object.create(null)]))
    const valuesByGroup = Object.fromEntries(filterGroups.map(({ key }) => [key, new Map()]))
    for (const gift of gifts) {
      for (const { key } of filterGroups) {
        const value = trimText(key === 'collection' ? gift.collection_name : gift[key])
        const normalized = key === 'collection' ? resolveGiftCollectionNormalized(gift) : normalizeFilterValue(value)
        if (!normalized) continue
        countsByGroup[key][normalized] = (countsByGroup[key][normalized] ?? 0) + 1
        if (!valuesByGroup[key].has(normalized)) valuesByGroup[key].set(normalized, value)
      }
    }
    return { countsByGroup, valuesByGroup }
  }, [gifts, resolveGiftCollectionNormalized])

  const optionsByGroup = useMemo(() => {
    const fallbackOptions = key => [...valuesByGroup[key]].map(([normalized, value]) => ({
      value, rarity: null, icon: groupIcons[key],
      quantity: String((quantityCounts ?? countsByGroup)[key]?.[normalized] ?? 0),
    }))
    if (!hasLoadedFiltersCatalog) {
      return Object.fromEntries(filterGroups.map(({ key }) => [key, fallbackOptions(key)]))
    }

    const buildOptions = (items, groupKey) => {
      const onSale = (item) => onSaleCounts
        ? onSaleCounts[groupKey]?.[item.id] ?? 0
        : Number.isFinite(item?.onSaleCount) ? item.onSaleCount : null
      const dedup = new Map()
      for (const item of items) {
        const value = trimText(item?.name)
        const normalized = normalizeFilterValue(value)
        if (!normalized) continue
        if (dedup.has(normalized)) {
          const existing = dedup.get(normalized)
          if (!quantityCounts && onSale(item) != null) {
            existing.quantity = String(Number(existing.quantity) + onSale(item))
          }
          if (existing.rarity !== formatRarityValue(item.rarity)) existing.rarity = null
          continue
        }
        const quantity = quantityCounts
          ? quantityCounts[groupKey]?.[normalized] ?? 0
          : onSale(item) ?? (countsByGroup[groupKey]?.[normalized] || 0)
        dedup.set(normalized, {
          value,
          rarity: formatRarityValue(item?.rarity),
          quantity: String(quantity),
          icon: groupIcons[groupKey],
          ...optionPreview(groupKey, item, value),
        })
      }
      return [...dedup.values()].sort((a, b) => a.value.localeCompare(b.value))
    }
    const selectedScopedModels = selectedCollectionShortNames.flatMap((shortName) => {
      const scopedFilters = collectionScopedFilters[shortName]
      return Array.isArray(scopedFilters?.models) ? scopedFilters.models : []
    })
    const scopedFilters = activeCollectionShortName ? collectionScopedFilters[activeCollectionShortName] : null
    const backgroundItems = scopedFilters?.backgrounds ?? filtersCatalog.backgrounds
    const symbolItems = scopedFilters?.symbols ?? filtersCatalog.symbols

    const collectionOptions = buildOptions(filtersCatalog.collections, 'collection')
    const modelOptions = selectedCollectionShortNames.length > 0 ? buildOptions(selectedScopedModels, 'model') : []
    const backgroundOptions = buildOptions(backgroundItems, 'background')
    const symbolOptions = buildOptions(symbolItems, 'symbol')

    return {
      collection: collectionOptions.length > 0 ? collectionOptions : fallbackOptions('collection'),
      model: modelOptions,
      background: backgroundOptions.length > 0 ? backgroundOptions : fallbackOptions('background'),
      symbol: symbolOptions.length > 0 ? symbolOptions : fallbackOptions('symbol'),
    }
  }, [
    valuesByGroup,
    countsByGroup,
    quantityCounts,
    onSaleCounts,
    hasLoadedFiltersCatalog,
    filtersCatalog,
    selectedCollectionShortNames,
    activeCollectionShortName,
    collectionScopedFilters,
  ])

  useEffect(() => {
    if (!hasLoadedFiltersCatalog || !selected.model.length || !selectedCollectionShortNames.length ||
      !selectedCollectionShortNames.every(name => Array.isArray(collectionScopedFilters[name]?.models))) return
    const valid = new Set(optionsByGroup.model.map(option => normalizeFilterValue(option.value)))
    const retained = selected.model.filter(value => valid.has(normalizeFilterValue(value)))
    if (retained.length === selected.model.length) return
    setSelected(previous => ({ ...previous, model: retained }))
  }, [hasLoadedFiltersCatalog, selected.model, selectedCollectionShortNames, collectionScopedFilters, optionsByGroup.model, setSelected])

  const toggleFilterValue = (key, value) => {
    setSelected((prev) => {
      if (key === 'model' && prev.collection.length === 0) return prev
      const current = prev[key]
      const nextValues = current.includes(value) ? current.filter((item) => item !== value) : [...current, value]
      const nextSelected = { ...prev, [key]: nextValues }
      return key === 'collection' && nextValues.length === 0 ? { ...nextSelected, model: [] } : nextSelected
    })
  }

  const clearFilter = (key) =>
    setSelected((prev) => {
      const nextSelected = { ...prev, [key]: [] }
      return key === 'collection' ? { ...nextSelected, model: [] } : nextSelected
    })

  const selectAllFilterValues = (key) => {
    if (key === 'model' && selected.collection.length === 0) return
    const allValues = (optionsByGroup[key] || []).map((option) => option.value)
    setSelected((prev) => ({ ...prev, [key]: allValues }))
  }

  const isAllSelected = (key) => {
    const options = optionsByGroup[key] || []
    const values = selectedValuesByGroup[key]
    return options.length > 0 && values.size === options.length &&
      options.every(option => values.has(option.value))
  }

  const toggleSelectAll = (key) =>
    isAllSelected(key) ? clearFilter(key) : selectAllFilterValues(key)

  const getFilterSummary = (key) => {
    const values = selected[key]
    if (values.length === 0 || isAllSelected(key)) return t('common.all')
    if (values.length === 1) return values[0]
    return `${values[0]} +${values.length - 1}`
  }

  const handleHorizontalWheel = (event) => {
    const el = event.currentTarget
    if (el.scrollWidth <= el.clientWidth) return
    const delta = event.deltaX !== 0 ? event.deltaX : event.deltaY
    if (delta === 0) return

    event.preventDefault()
    event.stopPropagation()
    el.scrollLeft += delta
  }

  return {
    optionsByGroup,
    toggleFilterValue,
    clearFilter,
    isAllSelected,
    toggleSelectAll,
    getFilterSummary,
    handleHorizontalWheel,
  }
}
