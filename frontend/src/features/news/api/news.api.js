import { request } from '../../../shared/api/client.js'

export function getNews(options) {
  return request('/news?limit=20', options)
}

export function createNews(news, options) {
  return request('/news', { ...options, method: 'POST', body: news })
}

export function updateNews(newsId, changes, options) {
  return request(`/news/${newsId}`, { ...options, method: 'POST', body: changes })
}

export function deleteNews(newsId, options) {
  return request(`/news/${newsId}`, { ...options, method: 'DELETE' })
}
