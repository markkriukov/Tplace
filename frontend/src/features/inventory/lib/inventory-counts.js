import { normalizeFilterValue } from '../../gifts/lib/gift-utils.js'

const GROUPS = ['collection', 'model', 'background', 'symbol']

/**
 * Each filter option's quantity among the section's gifts that match the
 * selections of the other groups: the number of gifts choosing it would add.
 */
export function getInventoryFilterCounts(section, selected) {
  const counts = Object.fromEntries(GROUPS.map(key => [key, Object.create(null)]))
  const selections = GROUPS.map(key => new Set((selected?.[key] ?? []).map(normalizeFilterValue)))
  for (const combination of section?.combinations ?? []) {
    const values = GROUPS.map(key => normalizeFilterValue(combination[key]))
    const misses = values.map((value, index) => selections[index].size > 0 && !selections[index].has(value))
    const missCount = misses.filter(Boolean).length
    GROUPS.forEach((key, index) => {
      // Only the group's own selection may exclude the combination.
      if (!values[index] || missCount > (misses[index] ? 1 : 0)) return
      counts[key][values[index]] = (counts[key][values[index]] ?? 0) + combination.quantity
    })
  }
  return counts
}
