export const filterGroups = [
  { key: 'collection' },
  { key: 'model' },
  { key: 'background' },
  { key: 'symbol' },
]

export const sortOptions = [
  'created', 'price', 'collection', 'modelRarity', 'backgroundRarity', 'symbolRarity', 'giftNumber',
].flatMap((key) => [{ id: `${key}Asc` }, { id: `${key}Desc` }])

/** A page size from the environment: a positive integer of at most 200, else 20. */
function readPageSize(raw) {
  const value = Number.parseInt(raw ?? '20', 10)
  return Number.isInteger(value) && value > 0 ? Math.min(value, 200) : 20
}

export const SEARCH_PAGE_SIZE = readPageSize(import.meta.env?.VITE_SEARCH_PAGE_SIZE)
export const INVENTORY_PAGE_SIZE = readPageSize(import.meta.env?.VITE_INVENTORY_PAGE_SIZE)
