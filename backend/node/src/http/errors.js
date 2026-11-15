// Services return only successes; every failure is thrown with a stable code.
/** @param {number} statusCode @param {string} message @param {string} [code] */
export function createHttpError(statusCode, message, code = 'REQUEST_FAILED') {
  return Object.assign(new Error(message), { statusCode, code })
}

// express.json() reports failures through http-errors `type` values.
/** @type {Record<string, {status: number, code: string, message: string}>} */
const bodyParserErrors = {
  'entity.too.large': { status: 413, code: 'BODY_TOO_LARGE', message: 'Request body is too large' },
  'entity.parse.failed': { status: 400, code: 'INVALID_JSON', message: 'Invalid JSON body' },
  'encoding.unsupported': { status: 415, code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Unsupported content encoding' },
  'charset.unsupported': { status: 415, code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Unsupported charset' },
}

// Unconfigured subsystems answer 503 with a fixed message.
/** @type {Record<string, string>} */
const unavailableMessages = {
  CUSTODY_NOT_CONFIGURED: 'Gift custody is not configured',
  TON_NOT_CONFIGURED: 'Transfers are not configured yet',
}

/** @param {unknown} error */
export function publicError(error) {
  const failure = /** @type {{statusCode?: number, code?: string, message?: string, name?: string, type?: string, original?: {code?: string}}} */ (error ?? {})
  if (failure.type && bodyParserErrors[failure.type]) return bodyParserErrors[failure.type]
  if (failure.statusCode === 503 && failure.code && unavailableMessages[failure.code]) {
    return { status: 503, code: failure.code, message: unavailableMessages[failure.code] }
  }
  if (failure.statusCode && failure.statusCode >= 400 && failure.statusCode < 500) {
    return { status: failure.statusCode, code: failure.code ?? 'REQUEST_FAILED', message: failure.message ?? 'Request failed' }
  }
  if (failure.name === 'SequelizeUniqueConstraintError') {
    return { status: 409, code: 'CONFLICT', message: 'The operation conflicts with the current state' }
  }
  if (['40P01', '40001', '55P03'].includes(failure.original?.code ?? '')) {
    return { status: 409, code: 'CONCURRENT_UPDATE', message: 'State changed concurrently. Refresh and retry.' }
  }
  // statement_timeout (57014) or an exhausted connection pool: the request may be retried.
  if (failure.original?.code === '57014' || failure.name === 'SequelizeConnectionAcquireTimeoutError') {
    return { status: 503, code: 'DATABASE_BUSY', message: 'The service is busy. Retry shortly.' }
  }
  return { status: 500, code: 'INTERNAL_ERROR', message: 'Internal server error' }
}
