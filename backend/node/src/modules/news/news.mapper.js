import { toIsoString } from '../../http/serialize.js'

export function mapNewsPayload(news) {
  return {
    id: news.public_id,
    title: news.title,
    lead: news.lead ?? '',
    content: news.content,
    image_url: news.image_url ?? null,
    published_at: toIsoString(news.published_at),
  }
}
