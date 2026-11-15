import { rateLimit } from 'express-rate-limit'
import { createHttpError } from './errors.js'

const safeMethods = ['GET', 'HEAD', 'OPTIONS']

/** Reject through the error handler so 429s share the API error envelope.
 * @param {import('express').Request} req @param {import('express').Response} _res @param {import('express').NextFunction} next */
const reject = (req, _res, next) => {
  const resetTime = /** @type {any} */ (req).rateLimit?.resetTime
  const retryAfter = resetTime instanceof Date ? Math.max(1, Math.ceil((resetTime.getTime() - Date.now()) / 1000)) : 60
  next(Object.assign(createHttpError(429, 'Too many requests', 'RATE_LIMITED'), { retryAfter }))
}

/** @param {{limit: number, windowMs?: number, writesOnly?: boolean, keyGenerator?: (req: any, res: any) => string, skip?: (req: any, res: any) => boolean}} options */
export function createRateLimiter({ limit, windowMs = 60_000, writesOnly = false, keyGenerator, skip = () => false }) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: false,
    legacyHeaders: false,
    handler: reject,
    skip: (req, res) => skip(req, res) || (writesOnly && safeMethods.includes(req.method)),
    ...(keyGenerator ? { keyGenerator } : {}),
  })
}
