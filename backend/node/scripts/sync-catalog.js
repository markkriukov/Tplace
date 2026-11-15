import { initDatabase } from '../src/db/init.js'
import { sequelize } from '../src/db/sequelize.js'
import { syncChangesCatalog } from '../src/modules/catalog/sync/sync.service.js'

try {
  await initDatabase()
  const args = process.argv.slice(2)
  if (args.some((arg) => arg !== '--refresh')) throw new Error('Usage: npm run db:catalog:sync -- [--refresh]')
  const result = await syncChangesCatalog({
    refresh: args.includes('--refresh'),
    onProgress: (completed, total) => {
      if (completed % 10 === 0 || completed === total) {
        console.log(`Changes API: loaded ${completed}/${total} collections`)
      }
    },
  })
  console.log(result.skipped ? 'Using saved catalog (no API requests):' : 'Changes API catalog saved:', result)
} catch (error) {
  console.error('Reference data import failed:', error)
  process.exitCode = 1
} finally {
  await sequelize.close()
}
