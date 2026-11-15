import { trimText, parseCatalogRarity, isHiddenCollection } from '../../gifts/lib/gift-utils.js'

function common(item, name = item.name) {
  const count = item.on_sale_count
  return {
    id: item.id, name: trimText(name), rarity: parseCatalogRarity(item.rarity),
    onSaleCount: count != null && count !== '' && Number.isFinite(Number(count)) ? Number(count) : null,
  }
}

function mapItems(items, mapper) {
  return (Array.isArray(items) ? items : []).filter(item => item && typeof item === 'object')
    .map(mapper).filter(item => item.name)
}

// Normalize once per network response, then share the same objects from cache.
export function mapFilterCatalog(payload) {
  const imageItem = item => ({ ...common(item), url: trimText(item.url) })
  return {
    collections: mapItems(payload.collections, item => ({
      ...common(item, item.display_name || item.short_name),
      shortName: trimText(item.short_name),
      regularId: trimText(item.collection_regular_id),
      photoUrl: trimText(item.photo_url),
    })).filter(item => !isHiddenCollection(item.shortName, item.name)),
    models: mapItems(payload.models, imageItem),
    backgrounds: mapItems(payload.backgrounds, item => ({
      ...common(item), centerColor: item.center_color, edgeColor: item.edge_color, patternColor: item.pattern_color,
    })),
    symbols: mapItems(payload.symbols, imageItem),
  }
}
