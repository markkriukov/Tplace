import { normalizeFilterValue, trimText } from '../../gifts/lib/gift-utils.js'

// Labels remain UI state. Resolve all matching IDs (including models with the
// same name in different collections) before sending a request.
export function buildFilterPayload(selected, catalog) {
  const modelsReady = catalog.selectedCollectionShortNames.length > 0 &&
    catalog.selectedCollectionShortNames.every(name => Array.isArray(catalog.collectionScopedFilters[name]?.models))
  const items = {
    collection: catalog.filtersCatalog.collections,
    background: catalog.activeCollectionShortName
      ? catalog.collectionScopedFilters[catalog.activeCollectionShortName]?.backgrounds ?? catalog.filtersCatalog.backgrounds
      : catalog.filtersCatalog.backgrounds,
    symbol: catalog.activeCollectionShortName
      ? catalog.collectionScopedFilters[catalog.activeCollectionShortName]?.symbols ?? catalog.filtersCatalog.symbols
      : catalog.filtersCatalog.symbols,
    model: catalog.selectedCollectionShortNames.flatMap((name) => catalog.collectionScopedFilters[name]?.models ?? []),
  }
  const payload = {}
  for (const key of ['collection', 'model', 'background', 'symbol']) {
    const values = (selected[key] ?? []).map(trimText).filter(Boolean)
    if (!values.length) continue
    const idsByName = new Map()
    for (const item of items[key]) {
      if (!item.id) continue
      const name = normalizeFilterValue(item.name)
      const ids = idsByName.get(name) ?? []
      ids.push(String(item.id))
      idsByName.set(name, ids)
    }
    const matches = values.map(value => idsByName.get(normalizeFilterValue(value)) ?? [])
    if ((key !== 'model' || modelsReady) && matches.every((group) => group.length)) {
      payload[`${key}_id`] = [...new Set(matches.flat())].sort()
    } else {
      payload[key] = values
    }
  }
  return payload
}
