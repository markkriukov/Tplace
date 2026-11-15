import { createHash } from 'node:crypto'
import { createHttpError } from './errors.js'
import { isPublicId } from './public-id.js'

// An opaque keyset cursor holds the last row's sort value and public ID. Its
// scope binds it to the filters and sort order that produced it. A timestamptz
// value is held as its UTC wall time, so cursors do not depend on the session
// time zone.

function invalidCursor() {
  return createHttpError(400, 'Invalid cursor for these filters or sort order', 'INVALID_CURSOR')
}

function validCursorValue(value, type) {
  if (type === 'text') return true
  if (type === 'bigint') {
    if (!/^-?\d{1,19}$/.test(value)) return false
    const integer = BigInt(value)
    return integer >= -9223372036854775808n && integer <= 9223372036854775807n
  }
  if (type === 'numeric') return /^-?\d+(\.\d+)?$/.test(value)
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?$/.test(value) || value.startsWith('0000')) return false
  const iso = value.replace(' ', 'T')
  const date = new Date(iso + 'Z')
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 19) === iso.slice(0, 19)
}

export function cursorScope(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

/** SQL selecting `expression` as the cursor_value text of its type. */
export function cursorValueSql(expression, type) {
  return type === 'timestamptz' ? `((${expression}) AT TIME ZONE 'UTC')::text` : `(${expression})::text`
}

const cursorValueCast = (type) => type === 'timestamptz'
  ? "(CAST(:cursorValue AS timestamp) AT TIME ZONE 'UTC')" : `CAST(:cursorValue AS ${type})`

export function encodeCursor(scope, row) {
  return Buffer.from(JSON.stringify({ scope, id: row.public_id, value: row.cursor_value })).toString('base64url')
}

/**
 * Adds the keyset condition for rawCursor to where/replacements.
 * idLookup is SQL returning the internal key for :cursorId.
 */
export function addCursorCondition(where, replacements, rawCursor, { scope, expression, type, idExpression, idLookup, direction, nullable }) {
  if (!rawCursor) return
  let cursor
  try {
    if (typeof rawCursor !== 'string' || rawCursor.length > 8192) throw invalidCursor()
    cursor = JSON.parse(Buffer.from(rawCursor, 'base64url').toString('utf8'))
    if (cursor.scope !== scope || !isPublicId(cursor.id) ||
        !(cursor.value === null || typeof cursor.value === 'string') ||
        (cursor.value !== null && cursor.value.length > 2048)) throw invalidCursor()
    if (cursor.value !== null && !validCursorValue(cursor.value, type)) throw invalidCursor()
  } catch { throw invalidCursor() }
  const comparison = direction === 'ASC' ? '>' : '<'
  const key = `(${idLookup})`
  const value = cursorValueCast(type)
  replacements.cursorId = cursor.id.toLowerCase()
  replacements.cursorValue = cursor.value
  if (cursor.value === null) {
    if (!nullable) throw invalidCursor()
    where.push(`(${expression} IS NULL AND ${idExpression} ${comparison} ${key})`)
  } else if (!nullable) {
    where.push(`(${expression}, ${idExpression}) ${comparison} (${value}, ${key})`)
  } else {
    where.push(`(${expression} ${comparison} ${value}
      OR (${expression} = ${value} AND ${idExpression} ${comparison} ${key})
      OR ${expression} IS NULL)`)
  }
}

/** Splits a limit + 1 row fetch into the page and its pagination payload. */
export function pageOf(rows, limit, scope) {
  const page = rows.slice(0, limit)
  const hasMore = rows.length > limit
  return { page, pagination: { limit, has_more: hasMore, next_cursor: hasMore ? encodeCursor(scope, page.at(-1)) : null } }
}
