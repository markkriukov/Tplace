import { sequelize } from '../src/db/sequelize.js'

// Grant or revoke administrator rights. The user must have signed in once.
// Every admin request rereads the flag, so the change applies immediately.
const [telegramId, value] = process.argv.slice(2)
try {
  if (!/^[1-9][0-9]{0,18}$/.test(telegramId || '') || !['true', 'false'].includes(value) || !process.env.OPERATOR_ID) {
    throw new Error('Usage: OPERATOR_ID=... set-admin TELEGRAM_USER_ID true|false')
  }
  const [rows] = await sequelize.query(`UPDATE users SET is_admin = :isAdmin
    WHERE telegram_id = :telegramId RETURNING public_id::text AS id, is_admin`, { replacements: { telegramId, isAdmin: value === 'true' } })
  if (!rows.length) throw new Error('User not found')
  console.log(JSON.stringify({ event: 'admin_changed', operator: process.env.OPERATOR_ID, user_id: rows[0].id, is_admin: rows[0].is_admin }))
} catch (error) { console.error(error.message); process.exitCode = 1 }
finally { await sequelize.close() }
