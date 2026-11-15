import { MarketplaceFeeEntry } from '../../db/models.js'
import { sequelize } from '../../db/sequelize.js'

export async function recordMarketplaceFee({ listingId = null, offerId = null, amountNano, currencyCode, transaction }) {
  if (!transaction || (listingId == null) === (offerId == null)) {
    throw new Error('A fee needs a transaction and exactly one trade source')
  }
  if (typeof amountNano === 'number' && !Number.isSafeInteger(amountNano)) {
    throw new Error('Fee must be an exact integer amount')
  }
  const amount = BigInt(amountNano)
  if (amount < 0n) throw new Error('Fee cannot be negative')
  // Source IDs survive request retries: a listing can sell once, an offer can be accepted once.
  // A duplicate must fail the whole trade, never silently skip the accrual.
  return MarketplaceFeeEntry.create({
    fk_gift_listing_id: listingId,
    fk_offer_id: offerId,
    currency_code: currencyCode,
    amount_nano: amount.toString(),
  }, { transaction })
}

export async function readMarketplaceRevenue({ transaction } = {}) {
  // SUM(bigint) is numeric in PostgreSQL; keep totals as strings even above JS's safe range.
  const [totals] = await sequelize.query(`
    SELECT currency_code,
           SUM(amount_nano)::text AS accrued_nano,
           COALESCE(SUM(amount_nano) FILTER (WHERE fk_legacy_wallet_tx_id IS NOT NULL), 0)::text AS legacy_accrued_nano,
           COALESCE(SUM(amount_nano) FILTER (WHERE fk_legacy_wallet_tx_id IS NULL), 0)::text AS new_accrued_nano,
           COUNT(*)::text AS entries_count
    FROM marketplace_fee_entries
    GROUP BY currency_code
    ORDER BY currency_code
  `, { transaction })
  return totals
}

export async function getMarketplaceRevenue() {
  return { payload: { ok: true, totals: await readMarketplaceRevenue() } }
}
