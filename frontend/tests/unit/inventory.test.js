import test from 'node:test'
import assert from 'node:assert/strict'
import { getInventoryFilterCounts } from '../../src/features/inventory/lib/inventory-counts.js'

const section = {
  total: 7,
  combinations: [
    { collection: 'Bunny', model: 'Gold', background: 'Blue', symbol: 'Star', quantity: 2 },
    { collection: 'Bunny', model: 'Silver', background: 'Red', symbol: 'Star', quantity: 1 },
    { collection: 'Bear', model: 'Gold', background: 'Blue', symbol: 'Moon', quantity: 4 },
  ],
}
const none = { collection: [], model: [], background: [], symbol: [] }
const counts = (selected) => getInventoryFilterCounts(section, { ...none, ...selected })

test('inventory filter counts cover the whole section without selections', () => {
  const all = counts({})
  assert.deepEqual({ ...all.collection }, { bunny: 3, bear: 4 })
  assert.deepEqual({ ...all.model }, { gold: 6, silver: 1 })
  assert.deepEqual({ ...all.background }, { blue: 6, red: 1 })
  assert.deepEqual({ ...all.symbol }, { star: 3, moon: 4 })
  assert.equal(section.total, 7)
})

test('inventory filter counts follow the selections of every other group', () => {
  const bunny = counts({ collection: [' Bunny '] })
  assert.deepEqual({ ...bunny.collection }, { bunny: 3, bear: 4 })
  assert.deepEqual({ ...bunny.model }, { gold: 2, silver: 1 })
  assert.deepEqual({ ...bunny.background }, { blue: 2, red: 1 })

  // A selected model narrows the other groups beyond its collection.
  const silver = counts({ collection: ['Bunny'], model: ['Silver'] })
  assert.deepEqual({ ...silver.background }, { red: 1 })
  assert.deepEqual({ ...silver.symbol }, { star: 1 })
  assert.deepEqual({ ...silver.model }, { gold: 2, silver: 1 })
  assert.deepEqual({ ...silver.collection }, { bunny: 1 })

  const blue = counts({ background: ['Blue'] })
  assert.deepEqual({ ...blue.collection }, { bunny: 2, bear: 4 })
  assert.deepEqual({ ...blue.background }, { blue: 6, red: 1 })
  assert.deepEqual({ ...counts({ collection: ['Bunny', 'Bear', 'bunny'], model: ['Gold'] }).symbol }, { star: 2, moon: 4 })
  assert.equal(Object.keys(counts({ collection: ['Missing'] }).model).length, 0)
  assert.equal(Object.keys(getInventoryFilterCounts(null, none).collection).length, 0)
})
