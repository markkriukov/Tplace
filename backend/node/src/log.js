/** Describe an error without its message: driver and RPC messages may embed SQL
 * text, user data or tokens. Type, codes, constraint names and stack frames are
 * enough to locate a failure.
 * @param {unknown} error */
function errorFields(error) {
  if (!(error instanceof Error)) return { error_type: typeof error }
  const failure = /** @type {Error & {code?: unknown, original?: {code?: unknown, constraint?: unknown}}} */ (error)
  const code = failure.original?.code ?? failure.code
  const frames = (failure.stack ?? '').split('\n').filter(line => line.startsWith('    at ')).map(line => line.trim())
  return {
    error_type: failure.name,
    ...(code != null ? { error_code: String(code) } : {}),
    ...(failure.original?.constraint ? { constraint: String(failure.original.constraint) } : {}),
    ...(failure.cause instanceof Error ? { cause_type: failure.cause.name } : {}),
    stack: frames.slice(0, 15),
  }
}

/** @param {string} event @param {unknown} error @param {Record<string, unknown>} [fields] @param {Pick<Console, 'error'>} [logger] */
export function logError(event, error, fields = {}, logger = console) {
  logger.error(JSON.stringify({ event, ...fields, ...errorFields(error) }))
}
