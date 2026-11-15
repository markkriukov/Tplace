import { loadFilterCatalog } from '../lib/filter-catalog-cache.js'
import { useState, useMemo, useEffect } from 'react'
import { useFilterRefreshRevision } from './useFilterRefreshRevision.js'
import {
  normalizeFilterValue,
  trimText,
} from '../../gifts/lib/gift-utils.js'

export function useFilterCatalog({ selected, enabled = true }) {
  const [filtersCatalog, setFiltersCatalog] = useState({
    collections: [],
    backgrounds: [],
    symbols: [],
  })

  const [collectionScopedFilters, setCollectionScopedFilters] = useState({})

  const [hasLoadedFiltersCatalog, setHasLoadedFiltersCatalog] = useState(false)
  const revision = useFilterRefreshRevision(enabled)

  const selectedCollectionShortNames = useMemo(() => {
    if (!hasLoadedFiltersCatalog || selected.collection.length === 0) return []

    const shortNameByDisplayName = new Map()
    for (const collection of filtersCatalog.collections) {
      const displayNameNormalized = normalizeFilterValue(collection?.name)
      const shortName = trimText(collection?.shortName)
      if (!displayNameNormalized || !shortName) continue
      shortNameByDisplayName.set(displayNameNormalized, shortName)
    }

    const uniqueShortNames = new Set()
    for (const value of selected.collection) {
      const normalizedValue = normalizeFilterValue(value)
      if (!normalizedValue) continue
      const resolved = shortNameByDisplayName.get(normalizedValue) || trimText(value)
      if (!resolved) continue
      uniqueShortNames.add(resolved)
    }
    return [...uniqueShortNames]
  }, [hasLoadedFiltersCatalog, selected.collection, filtersCatalog])

  const collectionRegularIdByShortName = useMemo(() => {
    const mapping = {}
    for (const collection of filtersCatalog.collections) {
      const shortName = trimText(collection?.shortName)
      const regularId = trimText(collection?.regularId)
      if (!shortName || !regularId) continue
      mapping[shortName] = regularId
    }
    return mapping
  }, [filtersCatalog])

  const activeCollectionShortName =
    selectedCollectionShortNames.length === 1 ? selectedCollectionShortNames[0] : ''

  useEffect(() => {
    if (!enabled) return
    let current = true

    const loadFiltersCatalog = async () => {
      try {
        const payload = await loadFilterCatalog()
        if (!current) return
        setFiltersCatalog(payload)
        setHasLoadedFiltersCatalog(true)
      } catch { /* Keep the last successful catalog until refresh succeeds. */ }
    }

    loadFiltersCatalog()

    return () => {
      current = false
    }
  }, [enabled, revision])

  const scopeKey = JSON.stringify(selectedCollectionShortNames.map(shortName => ({
    shortName, regularId: collectionRegularIdByShortName[shortName] ?? '',
  })))
  useEffect(() => {
    if (!enabled) return
    const collections = JSON.parse(scopeKey)
    if (!collections.length) return
    let current = true
    const loadCollectionScopedFilters = async () => {
      const responses = await Promise.allSettled(collections.map(async collection => [
        collection.shortName, await loadFilterCatalog(collection),
      ]))
      if (!current) return
      const entries = responses.filter(result => result.status === 'fulfilled').map(result => result.value)
      if (!entries.length) return
      setCollectionScopedFilters(previous => {
        if (entries.every(([key, value]) => previous[key] === value)) return previous
        return { ...previous, ...Object.fromEntries(entries) }
      })
    }

    loadCollectionScopedFilters()

    return () => {
      current = false
    }
  }, [enabled, scopeKey, revision])
  return useMemo(() => ({
    filtersCatalog,
    collectionScopedFilters,
    hasLoadedFiltersCatalog,
    selectedCollectionShortNames,
    activeCollectionShortName,
  }), [filtersCatalog, collectionScopedFilters, hasLoadedFiltersCatalog, selectedCollectionShortNames, activeCollectionShortName])
}
