/** ISO 8601 UTC text of a timestamptz expression, with milliseconds. */
export function isoTimestampSql(expression) {
  return `to_char(${expression} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`
}

/** Joins a gift `g` to the catalog rows that name its attributes. */
export const GIFT_ATTRIBUTE_JOINS = `
    JOIN models m ON m.pk_model_id = g.fk_model_id
    JOIN collections c ON c.pk_collection_id = g.fk_collection_id
    JOIN backgrounds b ON b.pk_background_id = g.fk_background_id
    JOIN symbols s ON s.pk_symbol_id = g.fk_symbol_id`
