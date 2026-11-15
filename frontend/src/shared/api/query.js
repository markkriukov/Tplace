/** Query string for API parameters; array values repeat their key. */
export function toQueryString(params) {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value == null || value === '') continue
    for (const item of Array.isArray(value) ? value : [value]) query.append(key, String(item))
  }
  return query.toString()
}
