import { Op } from 'sequelize'
import { createHttpError } from '../../http/errors.js'
import { parseLimit } from '../../http/pagination.js'
import { NEWS_LIMITS } from '../../config.js'
import { News } from '../../db/models.js'
import { mapNewsPayload } from './news.mapper.js'

// The request schema requires a non-blank title and content and validates the ID.
const optionalText = (value) => String(value ?? '').trim() || null

// News is published exactly when it has a publication date;
// the API's is_published sets or clears that date.

export async function listNews({ query }) {
  const news = await News.findAll({
    attributes: ['public_id', 'pk_news_id', 'title', 'lead', 'content', 'image_url', 'published_at'],
    where: { published_at: { [Op.ne]: null } },
    order: [
      ['published_at', 'DESC'],
      ['created_at', 'DESC'],
    ],
    limit: parseLimit(query, NEWS_LIMITS),
    raw: true,
  })
  return { payload: { ok: true, news: news.map(mapNewsPayload) } }
}

export async function createNews({ body }) {
  const now = new Date()
  const isPublished = body.is_published ?? true
  const news = await News.create({
    title: body.title.trim(),
    lead: optionalText(body.lead),
    content: body.content.trim(),
    image_url: optionalText(body.image_url),
    published_at: isPublished ? now : null,
    created_at: now,
    updated_at: now,
  })
  return { payload: { ok: true, news: mapNewsPayload(news) } }
}

export async function updateNews({ body, params }) {
  const news = await News.findOne({ where: { public_id: params.id } })
  if (!news) throw createHttpError(404, 'News not found', 'NOT_FOUND')
  if ('title' in body) news.title = body.title.trim()
  if ('content' in body) news.content = body.content.trim()
  if ('lead' in body) news.lead = optionalText(body.lead)
  if ('image_url' in body) news.image_url = optionalText(body.image_url)
  const now = new Date()
  if ('is_published' in body) news.published_at = body.is_published ? news.published_at ?? now : null
  news.updated_at = now
  await news.save()
  return { payload: { ok: true, news: mapNewsPayload(news) } }
}

export async function deleteNews({ params }) {
  const deleted = await News.destroy({ where: { public_id: params.id } })
  if (!deleted) throw createHttpError(404, 'News not found', 'NOT_FOUND')
  return { payload: { ok: true } }
}
