export function selectCartEntries(previous, update, gifts) {
  const ids = typeof update === 'function' ? update(previous.map(gift => gift.id)) : update
  const lookup = new Map(gifts.map(gift => [String(gift.id), gift]))
  // Preserve the quote explicitly selected by the user until a refresh is shown.
  for (const gift of previous) lookup.set(String(gift.id), gift)
  return [...new Set(ids.map(String))].map(id => lookup.get(id)).filter(Boolean)
}
