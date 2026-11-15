import {
  GIFT_WITHDRAWAL_FEE_NANO,
  MARKETPLACE_FEE_BPS,
  MARKETPLACE_MAX_PRICE_NANO,
  MARKETPLACE_MIN_PRICE_NANO,
} from '../../config.js'

export async function getMarketConfig() {
  return {
    payload: {
      ok: true,
      pricing: {
        min_price_nano: String(MARKETPLACE_MIN_PRICE_NANO),
        max_price_nano: String(MARKETPLACE_MAX_PRICE_NANO),
        marketplace_fee_bps: MARKETPLACE_FEE_BPS,
        gift_withdrawal_fee_nano: String(GIFT_WITHDRAWAL_FEE_NANO),
      },
    },
  }
}
