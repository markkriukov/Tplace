import { authenticateWithRetry } from '../src/db/init.js'
import { migrateDatabase } from '../src/db/migrations.js'
import { sequelize } from '../src/db/sequelize.js'

try {
  await authenticateWithRetry()
  const applied = await migrateDatabase()
  console.log(
    applied.length ? `Applied migrations: ${applied.join(', ')}` : 'Database is up to date'
  )
} catch (error) {
  console.error('Migration failed:', error)
  process.exitCode = 1
} finally {
  await sequelize.close()
}
