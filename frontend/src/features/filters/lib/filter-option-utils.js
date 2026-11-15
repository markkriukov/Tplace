const nameCollator = new Intl.Collator('en', { sensitivity: 'base', numeric: true })
const rarityTiers = { common: 100, uncommon: 50, rare: 10, epic: 5, legendary: 1, mythic: 0.1 }

const rarityValue = value => {
  const text = String(value ?? '').trim().toLowerCase()
  if (!text) return null
  const numeric = Number.parseFloat(text.replace(',', '.'))
  if (Number.isFinite(numeric)) return numeric
  return rarityTiers[text] ?? null
}

export function sortTagOptions(options, query, sortConfig) {
  const normalizedQuery = String(query ?? '')
    .trim()
    .toLowerCase()
  const filtered = normalizedQuery
    ? options.filter((option) => option.value.toLowerCase().includes(normalizedQuery))
    : options
  const direction = sortConfig.direction === 'desc' ? -1 : 1
  if (sortConfig.column === 'value') {
    return [...filtered].sort((a, b) => direction * nameCollator.compare(a.value, b.value))
  }
  const isRarity = sortConfig.column === 'rarity'
  // Parse each sort key once, rather than for every comparison.
  return filtered.map(option => ({
    option,
    value: isRarity ? rarityValue(option.rarity) : Number.parseInt(option.quantity, 10),
  })).sort((a, b) => {
    const left = a.value
    const right = b.value
    if (isRarity) {
      if (left == null || right == null) return left == null ? (right == null ? 0 : 1) : -1
    }
    return direction * (left - right)
  }).map(entry => entry.option)
}
