/** ISO 8601 text for a database timestamp, or null when it is absent.
 * @param {Date | string | null | undefined} value */
export function toIsoString(value) {
  return value ? new Date(value).toISOString() : null
}
