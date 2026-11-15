import { isPublicId } from './public-id.js'
import { Ajv } from 'ajv'
import { createHttpError } from './errors.js'

const ajv = new Ajv({ allErrors: false, strict: false })
ajv.addFormat('uuid', isPublicId)
ajv.addFormat('safe-id', (value) => /^[1-9][0-9]{0,15}$/.test(value) && BigInt(value) <= BigInt(Number.MAX_SAFE_INTEGER))
ajv.addFormat('bigint-id', (value) => /^[1-9][0-9]{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n)
export function validator(schema) {
  const validate = ajv.compile(schema)
  return (data) => {
    if (!validate(data)) {
      const issue = validate.errors?.[0]
      const path = issue?.instancePath || '/'
      throw createHttpError(400, `Invalid input at ${path}: ${issue?.message ?? 'validation failed'}`, 'VALIDATION_ERROR')
    }
    for (const name of ['limit', 'expires_in_hours']) {
      if (data[name] == null) continue
      const value = Number(data[name])
      const bounds = schema.properties?.[name]?.anyOf?.find((item) => item.type === 'integer')
      if (!Number.isSafeInteger(value) || value < bounds.minimum || value > bounds.maximum) {
        throw createHttpError(400, `Invalid ${name}`, 'VALIDATION_ERROR')
      }
    }
    return data
  }
}

export function queryObject(params) {
  const values = Object.create(null)
  for (const key of new Set(params.keys())) {
    const all = params.getAll(key)
    values[key] = all.length === 1 ? all[0] : all
  }
  return values
}
