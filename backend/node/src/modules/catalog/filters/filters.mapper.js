const nullable = (value, convert) => (value == null ? null : convert(value))

export function mapCollectionPayload(collection) {
  return {
    id: Number(collection.pk_collection_id),
    short_name: collection.short_name,
    display_name: collection.display_name ?? collection.short_name,
    collection_regular_id: nullable(collection.collection_regular_id, String),
    photo_url: collection.photo_url ?? null,
  }
}

export function mapModelPayload(model, onSaleCounts) {
  const id = Number(model.pk_model_id)
  return {
    id,
    name: model.name,
    rarity: model.rarity ?? null,
    url: model.url ?? null,
    on_sale_count: onSaleCounts.get(id) ?? 0,
  }
}

export function mapBackgroundPayload(background, onSaleCounts, rarity = null) {
  const id = Number(background.pk_background_id)
  return {
    id,
    name: background.name,
    rarity,
    center_color: nullable(background.center_color, Number),
    edge_color: nullable(background.edge_color, Number),
    pattern_color: nullable(background.pattern_color, Number),
    on_sale_count: onSaleCounts.get(id) ?? 0,
  }
}

export function mapSymbolPayload(symbol, onSaleCounts, rarity = null) {
  const id = Number(symbol.pk_symbol_id)
  return {
    id,
    name: symbol.name,
    rarity,
    url: symbol.url ?? null,
    on_sale_count: onSaleCounts.get(id) ?? 0,
  }
}
