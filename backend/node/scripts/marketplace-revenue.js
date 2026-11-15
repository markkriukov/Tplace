import { sequelize } from '../src/db/sequelize.js'
import { assertMigrationsCurrent } from '../src/db/migrations.js'
import { readMarketplaceRevenue } from '../src/modules/marketplace-fees/marketplace-fees.service.js'

try {
  await assertMigrationsCurrent()
  console.log(JSON.stringify({ totals: await readMarketplaceRevenue() }, null, 2))
} finally {
  await sequelize.close()
}
