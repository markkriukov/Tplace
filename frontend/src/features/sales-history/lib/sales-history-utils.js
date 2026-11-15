import { APP_CURRENCY } from '../../../shared/config/currency.js'
import { formatGramAmount } from '../../../shared/lib/gram-amount.js'
import { getDateFormatters } from '../../../shared/lib/date-formatters.js'

export function mapSalesHistoryItem(item, language = 'en') {
  const soldAt = item?.sold_at ? new Date(item.sold_at) : null
  const hasValidDate = soldAt instanceof Date && Number.isFinite(soldAt.getTime())
  const timeLabel = hasValidDate
    ? getDateFormatters(language).sale.format(soldAt)
    : '\u2014'
  const price = formatGramAmount(item?.price_nano ?? 0)
  const currency =
    typeof item?.currency_code === 'string' && item.currency_code.trim()
      ? item.currency_code.trim()
      : APP_CURRENCY
  return {
    id: String(item?.id ?? ''),
    gift_id: String(item?.gift_id ?? ''),
    gift: item?.gift ?? null,
    collectionName: item?.gift?.collection_name || '\u2014',
    modelName: item?.gift?.attributes?.model?.name || '\u2014',
    backgroundName: item?.gift?.attributes?.background?.name || '\u2014',
    symbolName: item?.gift?.attributes?.symbol?.name || '\u2014',
    priceLabel: `${price} ${currency}`,
    timeLabel,
  }
}
