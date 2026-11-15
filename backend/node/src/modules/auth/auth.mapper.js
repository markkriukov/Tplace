import { AUTH_TOKEN_TTL_SECONDS } from '../../config.js'
import { signToken } from './auth-token.signer.js'

export function buildAuthPayload(user, authSource) {
  const nowSeconds = Math.floor(Date.now() / 1000)
  const tokenPayload = {
    sub: user.public_id,
    username: user.username ?? null,
    is_admin: user.is_admin === true,
    ver: user.token_version,
    iat: nowSeconds,
    exp: nowSeconds + AUTH_TOKEN_TTL_SECONDS,
  }

  return {
    ok: true,
    auth_source: authSource,
    token: signToken(tokenPayload),
    user: { is_admin: user.is_admin === true },
  }
}
