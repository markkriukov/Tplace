import { startOfferExpiryWorker } from './modules/offers/offers-expiry.worker.js'
import { createApp } from './app.js'
import { PORT, validateConfiguration } from './config.js'
import { initDatabase } from './db/init.js'
import { sequelize } from './db/sequelize.js'
import { startPaymentWorker } from './modules/wallet/payments/payments.service.js'

async function start() {
  await validateConfiguration()
  await initDatabase()
  const stopPayments = startPaymentWorker()
  const stopOffers = startOfferExpiryWorker()
  const server = createApp().listen(PORT, () => console.log(`Backend listening on http://localhost:${PORT}`))
  server.requestTimeout = 15_000
  server.headersTimeout = 10_000
  const shutdown = () =>
    server.close(async () => {
      await Promise.all([stopPayments(), stopOffers()])
      sequelize.close().finally(() => process.exit(0))
    })
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}

start().catch((error) => {
  console.error('Failed to start backend:', error)
  process.exitCode = 1
})
