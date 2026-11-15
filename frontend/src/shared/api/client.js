import { notifyMarketChanged } from './market-events.js'
import { notifyAuthExpired } from './auth-events.js'

export class ApiError extends Error {
  constructor(message, status, data) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.data = data
  }
}

export function getApiBaseUrl() {
  const configured = String(import.meta.env?.VITE_API_BASE_URL ?? '/api').trim() || '/api'
  return new URL(configured, globalThis.location?.origin ?? 'http://localhost')
    .toString()
    .replace(/\/+$/, '')
}

// HTTP errors remain inspectable by flows; transport errors and cancellation propagate.
export async function request(path, { token, body, headers, signal, timeoutMs = 15_000, ...options } = {}) {
  const url = /^https?:\/\//.test(String(path)) ? path : getApiBaseUrl() + path
  const timeout = AbortSignal.timeout(timeoutMs)
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout
  const response = await fetch(url, {
    ...options,
    signal: requestSignal,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  })
  let data
  try {
    data = await response.json()
  } catch (error) {
    // Invalid JSON is inspectable, but a lost or timed out body is a transport failure.
    if (requestSignal.aborted) throw requestSignal.reason
    if (!(error instanceof SyntaxError)) throw error
    data = null
  }
  requestSignal.throwIfAborted()
  if (response.status === 401) notifyAuthExpired(token)
  const ok = response.ok && data?.ok !== false
  if (ok && data?.ok === true && options.method?.toUpperCase() === 'POST' &&
      /\/(?:gifts\/(?:list|buy|cancel|withdraw)|offers\/[^/]+\/accept)$/.test(new URL(url).pathname)) {
    notifyMarketChanged()
  }
  return {
    ok,
    status: response.status,
    data,
    error: ok
      ? null
      : new ApiError(data?.error || `HTTP ${response.status}`, response.status, data),
  }
}
