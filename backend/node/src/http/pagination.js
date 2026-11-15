/** The route schema bounds limit; this applies the endpoint's default and cap.
 * @param {URLSearchParams} query @param {{fallback: number, max: number}} limits */
export function parseLimit(query, { fallback, max }) {
  const value = Number.parseInt(query.get('limit') ?? '', 10)
  return Number.isInteger(value) && value > 0 ? Math.min(value, max) : fallback
}
