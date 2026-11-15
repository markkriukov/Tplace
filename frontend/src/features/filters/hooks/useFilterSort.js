import { useState } from 'react'

export function useFilterSort() {
  const [sortConfig, setSortConfig] = useState({ column: 'rarity', direction: 'asc' })
  const isSortColumnActive = (column) => sortConfig.column === column
  const getSortIndicator = (column) => isSortColumnActive(column)
    ? sortConfig.direction === 'asc' ? '\u25B2' : '\u25BC'
    : '\u2195'
  const toggleSortColumn = (column) => setSortConfig((prev) => ({
    column,
    direction: prev.column === column && prev.direction === 'asc' ? 'desc' : 'asc',
  }))

  return { sortConfig, isSortColumnActive, getSortIndicator, toggleSortColumn }
}
