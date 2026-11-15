import { isPublicId } from '../../http/public-id.js'
import { createHttpError } from '../../http/errors.js'
import { verifyToken } from './auth-token.signer.js'
import { User } from '../../db/models.js'

export function readBearerToken(req) {
  const raw = req.headers.authorization
  if (typeof raw !== 'string') return null
  const match = raw.match(/^Bearer\s+(.+)$/i)
  return match ? match[1].trim() : null
}

/** @returns {Promise<{user: any} | {error: string}>} */
async function authenticateRequest(req, res) {
  const token = readBearerToken(req)
  if (!token) return { error: 'Missing Bearer token' }
  // The app verifies the token once for rate limiting; reuse that result.
  const payload = res.locals.verifiedToken?.token === token ? res.locals.verifiedToken.payload : verifyToken(token)
  if (!payload) return { error: 'Invalid or expired token' }
  if (!isPublicId(payload.sub)) return { error: 'Invalid token payload' }
  // Handlers read only pk_user_id; is_admin and token_version gate the request.
  const user = await User.findOne({ attributes: ['pk_user_id', 'is_admin', 'token_version'], where: { public_id: payload.sub }, raw: true })
  if (!user) return { error: 'User not found for token' }
  if (payload.ver !== user.token_version) return { error: 'Token was revoked' }
  return { user }
}

/** Sets req.user. Modes: 'none' | 'optional' | 'required' | 'admin'.
 * @param {'none' | 'optional' | 'required' | 'admin'} mode
 * @returns {import('express').RequestHandler} */
export function authenticate(mode) {
  return async (req, res, next) => {
    if (mode === 'none') return next()
    const result = await authenticateRequest(req, res)
    if ('user' in result) /** @type {any} */ (req).user = result.user
    else if (mode !== 'optional') throw createHttpError(401, result.error, 'UNAUTHORIZED')
    if (mode === 'admin' && result.user.is_admin !== true) throw createHttpError(403, 'Admin access required', 'FORBIDDEN')
    next()
  }
}
