const counters = { requests: 0, server_errors: 0, rate_limited: 0, duration_ms: 0 }
const bounds = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000]
/** @type {Map<string, { requests: number, server_errors: number, rate_limited: number, duration_ms: number, max_duration_ms: number, response_bytes: number, buckets: number[] }>} */
const routes = new Map()
/** @param {number} status @param {number} duration @param {string} route @param {number} bytes */
export function recordRequest(status, duration, route = 'unmatched', bytes = 0) {
  counters.requests++
  counters.duration_ms += duration
  if (status >= 500) counters.server_errors++
  if (status === 429) counters.rate_limited++
  // Labels come only from router templates. Bound memory even if a future
  // caller accidentally passes dynamic paths; never retain query strings.
  if (route.includes('?') || (!routes.has(route) && routes.size >= 128)) route = 'unmatched'
  const entry = routes.get(route) ?? { requests: 0, server_errors: 0, rate_limited: 0,
    duration_ms: 0, max_duration_ms: 0, response_bytes: 0, buckets: Array(bounds.length + 1).fill(0) }
  entry.requests++
  entry.server_errors += Number(status >= 500)
  entry.rate_limited += Number(status === 429)
  entry.duration_ms += duration
  entry.max_duration_ms = Math.max(entry.max_duration_ms, duration)
  entry.response_bytes += bytes
  const bucket = bounds.findIndex(bound => duration <= bound)
  entry.buckets[bucket < 0 ? bounds.length : bucket]++
  routes.set(route, entry)
}
export function httpMetrics() {
  return { ...counters, routes: Object.fromEntries([...routes].map(([route, { buckets, ...entry }]) => [route, {
    ...entry, average_duration_ms: entry.duration_ms / entry.requests,
    // Disjoint duration buckets, including an overflow bucket; all-time per process.
    duration_buckets: Object.fromEntries([...bounds.map(String), '+Inf'].map((bound, index) => [bound, buckets[index]])),
  }])) }
}
