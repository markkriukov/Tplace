import { splitGiftName, buildFragmentGiftImage } from '../../gifts/gifts.mapper.js'

/** Maps a completed sale row from the sales history query. */
export function mapSalesHistoryPayload(row) {
  const giftId = Number(row.pk_gift_id)
  const parsedName = splitGiftName(row.name, giftId)
  return {
    id: row.public_id,
    gift_id: row.gift_id,
    gift: {
      title: parsedName.title,
      number: parsedName.number,
      image: buildFragmentGiftImage(parsedName, giftId),
      collection_name: row.collection_name,
      attributes: {
        model: { name: row.model_name },
        background: { name: row.background_name },
        symbol: { name: row.symbol_name },
      },
    },
    currency_code: row.currency_code,
    price_nano: String(row.price_nano),
    sold_at: row.sold_at,
  }
}
