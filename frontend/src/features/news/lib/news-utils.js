import { getDateFormatters } from '../../../shared/lib/date-formatters.js'
import { DEFAULT_PLACEHOLDER_IMAGE } from '../../../shared/config/placeholder-images.js'

export function mapNewsItemFromApi(item, language = 'en') {
  const publishedAt = item?.published_at ? new Date(item.published_at) : null
  const hasValidDate = publishedAt instanceof Date && Number.isFinite(publishedAt.getTime())
  const date = hasValidDate
    ? getDateFormatters(language).news.format(publishedAt)
    : ''

  return {
    id: String(item?.id ?? ''),
    title: String(item?.title ?? ''),
    lead: String(item?.lead ?? ''),
    text: String(item?.content ?? ''),
    date,
    image:
      typeof item?.image_url === 'string' && item.image_url.trim()
        ? item.image_url.trim()
        : DEFAULT_PLACEHOLDER_IMAGE,
    image_url: typeof item?.image_url === 'string' ? item.image_url : '',
  }
}
