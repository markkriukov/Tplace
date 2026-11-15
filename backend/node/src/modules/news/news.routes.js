import { listNews, createNews, updateNews, deleteNews } from './news.service.js'

export const routeNews = [
  { method: 'GET', path: '/news', handler: listNews, auth: 'none', query: 'limit', cache: 'public, no-cache' },
  { method: 'POST', path: '/news', handler: createNews, auth: 'admin', body: 'newsCreate', largeBody: true },
  { method: 'POST', path: '/news/{id}', handler: updateNews, auth: 'admin', body: 'newsUpdate', largeBody: true },
  { method: 'DELETE', path: '/news/{id}', handler: deleteNews, auth: 'admin' },
]
