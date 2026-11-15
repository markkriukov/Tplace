import { createHttpError } from './errors.js'

export const publicIdPattern = '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-7[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
const pattern = new RegExp(publicIdPattern)
export function isPublicId(value) {
  return typeof value === 'string' && pattern.test(value)
}
export function parsePublicId(value) {
  return isPublicId(value) ? value.toLowerCase() : null
}

// Resolve public references once, keeping joins and mutation locks on internal keys.
export async function resolveInternalId(model, primaryKey, value, options = {}) {
  const publicId = parsePublicId(value)
  if (!publicId) throw createHttpError(400, 'ID must be a UUIDv7', 'VALIDATION_ERROR')
  const row = await model.findOne({ ...options, attributes: [primaryKey], where: { ...options.where, public_id: publicId } })
  if (!row) throw createHttpError(404, 'Entity not found', 'NOT_FOUND')
  return row[primaryKey]
}
