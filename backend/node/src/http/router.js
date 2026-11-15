import { createHash } from 'node:crypto'
import { Router } from 'express'
import { getOperations } from '../modules/operations/operations.service.js'
import { routeAuth } from '../modules/auth/auth.routes.js'
import { routeGifts } from '../modules/gifts/gifts.routes.js'
import { routeNews } from '../modules/news/news.routes.js'
import { routeCatalog } from '../modules/catalog/catalog.routes.js'
import { routeWallet } from '../modules/wallet/wallet.routes.js'
import { routeUsers } from '../modules/users/users.routes.js'
import { routeOffers } from '../modules/offers/offers.routes.js'
import { routeMarketplaceFees } from '../modules/marketplace-fees/marketplace-fees.routes.js'
import { authenticate } from '../modules/auth/auth.middleware.js'
import { createHttpError } from './errors.js'
import { schemas, id, object } from './schemas.js'
import { validator, queryObject } from './validation.js'

// auth: 'none' | 'optional' | 'required' | 'admin'. Every /admin/* route must use 'admin'.
// cache (public reads only): Cache-Control for a 200, which then carries an ETag.
// Paths use OpenAPI templates ({id}); they double as metric labels.
export const routes = [routeAuth, routeGifts, routeNews, routeCatalog, routeWallet, routeUsers, routeOffers, routeMarketplaceFees, [{ method: 'GET', path: '/admin/operations', handler: getOperations, auth: 'admin' }]].flat()
for (const route of routes) {
  if (route.path.startsWith('/admin/') && route.auth !== 'admin') throw new Error(`${route.method} ${route.path} must require admin`)
}
const validateId = validator(object({ id }, ['id']))

/** A route's `cache` is a Cache-Control value, or a function of the request
 * context returning one or null (no-store, the API default). */
const cachePolicy = (cache, context) => typeof cache === 'function' ? cache(context) : cache

/** @type {import('express').RequestHandler} */
const requireJson = (req, _res, next) => {
  // Bodyless POSTs (Content-Length: 0) need no media type; express.json() skips them.
  const hasBody = req.headers['transfer-encoding'] !== undefined || Number(req.headers['content-length'] ?? 0) > 0
  next(hasBody && !req.is('application/json') ? createHttpError(415, 'Content-Type must be application/json', 'UNSUPPORTED_MEDIA_TYPE') : undefined)
}

/** Label is set first so metrics and logs see the route even when auth rejects. */
export function label(name) {
  return /** @type {import('express').RequestHandler} */ ((_req, res, next) => { res.locals.route = name; next() })
}

/** @param {{jsonBody: import('express').RequestHandler, largeJsonBody: import('express').RequestHandler}} options */
export function createApiRouter({ jsonBody, largeJsonBody }) {
  const router = Router()
  for (const [path, group] of Map.groupBy(routes, route => route.path)) {
    const chain = router.route(path.replaceAll('{id}', ':id'))
    for (const route of group) {
      const validateQuery = validator(schemas[route.query ?? 'empty'])
      const validateBody = route.body ? validator(schemas[route.body]) : null
      chain[route.method.toLowerCase()](
        label(`${route.method} ${route.path}`),
        authenticate(route.auth),
        (req, _res, next) => {
          if (req.params.id !== undefined) validateId(req.params)
          validateQuery(queryObject(req.query))
          next()
        },
        ...(validateBody ? [requireJson, route.largeBody ? largeJsonBody : jsonBody] : []),
        async (req, res) => {
          const body = validateBody ? validateBody(req.body === undefined ? {} : req.body) : undefined
          // Handlers return { payload } and set statusCode only when it is not 200.
          const context = { currentUser: req.user ?? null, body, query: req.query, params: req.params }
          const { statusCode = 200, payload } = await route.handler(context)
          const cacheControl = statusCode === 200 && route.cache ? cachePolicy(route.cache, context) : null
          // With optional auth the body depends on the viewer.
          if (route.cache && route.auth === 'optional') res.vary('Authorization')
          if (!cacheControl) return void res.status(statusCode).json(payload)
          // A cacheable read revalidates with an ETag of its body: an unchanged
          // payload costs the client a 304 without the body.
          const json = JSON.stringify(payload)
          res.set({ 'Cache-Control': cacheControl, ETag: `"${createHash('sha256').update(json).digest('base64url').slice(0, 27)}"` })
          if (req.fresh) return void res.status(304).end()
          res.type('application/json').send(json)
        },
      )
    }
    const allow = group.map(route => route.method).join(', ')
    chain.all((_req, res, next) => {
      res.set('Allow', allow)
      next(createHttpError(405, 'Method not allowed', 'METHOD_NOT_ALLOWED'))
    })
  }
  return router
}
