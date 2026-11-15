import test from 'node:test'
import assert from 'node:assert/strict'
import { buildFilterPayload } from '../../src/features/filters/lib/filter-search-payload.js'
import { normalizePaginationPayload } from '../../src/features/gifts/lib/gift-utils.js'

test('filters send every matching model ID across selected collections', () => {
  const catalog = {
    filtersCatalog: { collections: [{ id: '1', name: 'Fox' }, { id: '2', name: 'Cat' }], backgrounds: [], symbols: [] },
    selectedCollectionShortNames: ['fox', 'cat'], activeCollectionShortName: '',
    collectionScopedFilters: { fox: { models: [{ id: '11', name: 'Gold' }] }, cat: { models: [{ id: '21', name: 'Gold' }] } },
  }
  assert.deepEqual(buildFilterPayload({ collection: ['Fox', 'Cat'], model: ['Gold'] }, catalog), {
    collection_id: ['1', '2'], model_id: ['11', '21'],
  })
  assert.deepEqual(buildFilterPayload({ model: ['Still loading'] }, catalog), { model: ['Still loading'] })
})

test('pagination forwards cursors and clears the final page cursor', () => {
  assert.equal(normalizePaginationPayload({ has_more: true, next_cursor: 'opaque' }, 25).nextCursor, 'opaque')
  assert.equal(normalizePaginationPayload({ has_more: false, next_cursor: 'stale' }, 25).nextCursor, null)
})

test('model filters keep labels until every selected collection has loaded', () => {
  const catalog = {
    filtersCatalog: { collections: [], backgrounds: [], symbols: [] },
    selectedCollectionShortNames: ['fox', 'cat'], activeCollectionShortName: '',
    collectionScopedFilters: { fox: { models: [{ id: '11', name: 'Gold' }] } },
  }
  assert.deepEqual(buildFilterPayload({ model: ['Gold'] }, catalog), { model: ['Gold'] })
  catalog.collectionScopedFilters.cat = { models: [{ id: '21', name: 'Gold' }] }
  assert.deepEqual(buildFilterPayload({ model: ['Gold'] }, catalog), { model_id: ['11', '21'] })
})

test('partially loaded filter options retain every selected label and matching IDs are unique', () => {
  const catalog = {
    filtersCatalog: { collections: [], backgrounds: [], symbols: [] },
    selectedCollectionShortNames: ['bunny'], activeCollectionShortName: 'bunny',
    collectionScopedFilters: { bunny: { models: [{ id: 11, name: 'Gold' }, { id: 11, name: ' GOLD ' }] } },
  }
  assert.deepEqual(buildFilterPayload({ model: ['Gold', 'New model'] }, catalog), { model: ['Gold', 'New model'] })
  assert.deepEqual(buildFilterPayload({ model: [' gold ', 'Gold'] }, catalog), { model_id: ['11'] })
})
