import { sequelize } from '../../../db/sequelize.js'
import { createHttpError } from '../../../http/errors.js'

const columns = 'public_id::text AS id, username, max_count, status, result, error_code'
const mapJob = job => job ? {
  id: job.id, username: job.username, status: job.status, error_code: job.error_code,
  result: job.result ? { fetched: job.result.fetched, added: job.result.added, skipped: job.result.skipped } : null,
} : null

export async function getGiftImport({ currentUser }) {
  const [rows] = await sequelize.query(`SELECT ${columns} FROM admin_gift_imports
    WHERE fk_admin_user_id=:admin ORDER BY pk_gift_import_id DESC LIMIT 1`, { replacements: { admin: currentUser.pk_user_id } })
  return { payload: { ok: true, job: mapJob(rows[0]) } }
}

export async function createGiftImport({ currentUser, body }) {
  const username = body.username.trim().replace(/^@/, '').toLowerCase()
  return sequelize.transaction(async transaction => {
    const replacements = { admin: currentUser.pk_user_id, username, maxCount: body.max_count, key: body.request_key }
    await sequelize.query('SELECT pk_user_id FROM users WHERE pk_user_id=:admin FOR UPDATE', { replacements, transaction })
    const [existing] = await sequelize.query(`SELECT ${columns} FROM admin_gift_imports
      WHERE fk_admin_user_id=:admin AND request_key=:key`, { replacements, transaction })
    if (existing[0]) {
      if (existing[0].username !== username || existing[0].max_count !== body.max_count) {
        throw createHttpError(409, 'Request key was used for another import', 'IDEMPOTENCY_CONFLICT')
      }
      return { payload: { ok: true, job: mapJob(existing[0]) } }
    }
    const [active] = await sequelize.query("SELECT 1 FROM admin_gift_imports WHERE fk_admin_user_id=:admin AND status IN ('queued','running')", { replacements, transaction })
    if (active.length) throw createHttpError(409, 'An import is already in progress', 'IMPORT_IN_PROGRESS')
    const [rows] = await sequelize.query(`INSERT INTO admin_gift_imports(fk_admin_user_id, username, max_count, request_key)
      VALUES (:admin, :username, :maxCount, :key) RETURNING ${columns}`, { replacements, transaction })
    return { statusCode: 202, payload: { ok: true, job: mapJob(rows[0]) } }
  })
}
