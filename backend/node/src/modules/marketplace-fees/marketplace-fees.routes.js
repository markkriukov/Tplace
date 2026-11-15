import { getMarketplaceRevenue } from './marketplace-fees.service.js'

export const routeMarketplaceFees = [
  {
    method: 'GET', path: '/admin/marketplace/revenue', handler: getMarketplaceRevenue,
    auth: 'admin',
  },
]
