import express from 'express'
import cors from 'cors'
import { randomUUID } from 'node:crypto'
import { recordRequest } from './http/metrics.js'
import { trustProxy } from './security.js'
import { createApiRouter, label, routes } from './http/router.js'
import { buildOpenApi } from './http/openapi.js'
import { createHttpError, publicError } from './http/errors.js'
import { createRateLimiter } from './http/rate-limit.js'
import { sequelize } from './db/sequelize.js'
import { logError } from './log.js'
import { HTTP_RATE_LIMITS, corsSettings } from './config.js'
import { readBearerToken } from './modules/auth/auth.middleware.js'
import { verifyToken } from './modules/auth/auth-token.signer.js'

const openapi = buildOpenApi(routes)

/** The browser app uses same-origin /api, so production sends no CORS headers
 * unless origins are configured.
 * @param {{anyOrigin: boolean, origins: string[]}} settings */
const corsOptions = (settings) => ({
  origin: settings.anyOrigin ? '*' : settings.origins,
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  exposedHeaders: ['X-Request-Id', 'Retry-After'],
  maxAge: 600,
})

export function createApp({ maxBodyBytes = 65_536, maxNewsBodyBytes = 1_048_576, rateLimit = {}, cors: corsConfig = corsSettings(), logger = console } = {}) {
  const { maxRequests, maxWrites, maxAuth, userMaxRequests, userMaxWrites, windowMs } = { ...HTTP_RATE_LIMITS, ...rateLimit }
  const limiter = (limit, options = {}) => createRateLimiter({ limit, windowMs, ...options })
  const userKey = (_req, res) => res.locals.tokenSubject
  const signedIn = (_req, res) => res.locals.tokenSubject != null
  const anonymous = (req, res) => !signedIn(req, res)
  const app = express()
  app.disable('x-powered-by')
  app.set('etag', false)
  // Only configured proxy peers may supply a forwarded client address (req.ip).
  app.set('trust proxy', trustProxy)
  // Services read repeated filters with getAll(); the validator sees a plain object.
  app.set('query parser', query => new URLSearchParams(query ?? ''))

  app.use((_req, res, next) => {
    const started = performance.now()
    res.once('finish', () => recordRequest(res.statusCode, performance.now() - started, res.locals.route ?? 'unmatched', Number(res.getHeader('Content-Length') ?? 0)))
    res.locals.requestId = randomUUID()
    res.set({ 'X-Request-Id': res.locals.requestId, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' })
    next()
  })
  app.use(cors(corsOptions(corsConfig)))
  // A validly signed token gives the request its own per-user bucket on every
  // route, public ones included; the signature check needs no database. Address
  // limits apply only to anonymous requests, so clients that share an address
  // (one ingress, mobile NAT) never exhaust each other's limits.
  app.use((req, res, next) => {
    const token = readBearerToken(req)
    const payload = token ? verifyToken(token) : null
    if (token) res.locals.verifiedToken = { token, payload }
    const subject = payload?.sub
    res.locals.tokenSubject = typeof subject === 'string' ? subject : null
    next()
  })
  app.use(limiter(maxRequests, { skip: signedIn }))
  app.use(limiter(maxWrites, { writesOnly: true, skip: signedIn }))
  app.use(limiter(userMaxRequests, { keyGenerator: userKey, skip: anonymous }))
  app.use(limiter(userMaxWrites, { writesOnly: true, keyGenerator: userKey, skip: anonymous }))
  app.use(['/auth/telegram', '/dev/auth/login'], limiter(maxAuth))

  app.get('/health', label('GET /health'), (_req, res) => { res.json({ ok: true, service: 'backend' }) })
  app.get('/ready', label('GET /ready'), async (_req, res) => {
    await sequelize.query('SELECT 1')
    res.json({ ok: true })
  })
  app.get('/openapi.json', label('GET /openapi.json'), (_req, res) => { res.json(openapi) })
  app.use(createApiRouter({
    jsonBody: express.json({ limit: maxBodyBytes, strict: false }),
    largeJsonBody: express.json({ limit: maxNewsBodyBytes, strict: false }),
  }))
  app.use((_req, _res, next) => next(createHttpError(404, 'Endpoint not found', 'NOT_FOUND')))

  /** @type {import('express').ErrorRequestHandler} */
  const handleError = (error, _req, res, _next) => {
    const failure = publicError(error)
    if (failure.status >= 500) {
      logError('request_failed', error, { request_id: res.locals.requestId, route: res.locals.route ?? 'unmatched' }, logger)
    }
    if (res.headersSent) return void res.end()
    if ([413, 415].includes(failure.status)) res.set('Connection', 'close')
    if (failure.status === 429) res.set('Retry-After', String(error.retryAfter ?? 60))
    res.status(failure.status).json({ ok: false, error: failure.message, code: failure.code, request_id: res.locals.requestId })
  }
  app.use(handleError)
  return app
}
