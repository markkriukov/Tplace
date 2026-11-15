/** @param {NodeJS.ProcessEnv} [env] */
export function authSettings(env = process.env) {
  const secret = env.JWT_SECRET || ''
  if (Buffer.byteLength(secret) < 32 || secret === 'dev-jwt-secret-change-me') {
    throw new Error('JWT_SECRET must contain at least 32 bytes; generate a random secret')
  }
  if (env.NODE_ENV === 'production' && env.ALLOW_DEV_AUTH === 'true') {
    throw new Error('Development authentication is forbidden in production')
  }
  return { secret, allowDevAuth: devAuthAllowed(env) }
}

// Route registration happens at import; it must not require JWT_SECRET yet.
/** @param {NodeJS.ProcessEnv} [env] */
export function devAuthAllowed(env = process.env) {
  return env.NODE_ENV !== 'production' && env.ALLOW_DEV_AUTH === 'true'
}

/** Express `trust proxy` predicate. Trust only the direct TCP peer, and only when
 * it is listed in TRUSTED_PROXY_ADDRESSES, so req.ip becomes the rightmost
 * address appended by that proxy. The edge must overwrite untrusted forwarding headers.
 * @param {string} address @param {number} hop 0 is the socket peer, 1+ walk X-Forwarded-For from the right
 */
export function trustProxy(address, hop) {
  return hop === 0 && (process.env.TRUSTED_PROXY_ADDRESSES || '').split(',').map(value => value.trim()).includes(address)
}
