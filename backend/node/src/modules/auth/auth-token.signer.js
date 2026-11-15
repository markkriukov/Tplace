import jwt from 'jsonwebtoken'
import { authSettings } from '../../security.js'

/** @param {Record<string, unknown>} payload */
export function signToken(payload) {
  return jwt.sign(payload, authSettings().secret, { algorithm: 'HS256', noTimestamp: true })
}

/** @param {string} token */
export function verifyToken(token) {
  let payload
  try {
    payload = jwt.verify(token, authSettings().secret, { algorithms: ['HS256'] })
  } catch {
    return null
  }

  // jsonwebtoken accepts tokens without exp; every token here must expire.
  if (typeof payload !== 'object' || typeof payload.exp !== 'number') return null

  return payload
}
