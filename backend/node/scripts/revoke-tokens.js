import { sequelize } from '../src/db/sequelize.js'

// Invalidate every API token issued to one user. The Mini App signs in again
// with fresh Telegram initData the next time it is opened.
const [telegramId] = process.argv.slice(2)
try {
  if (!/^[1-9][0-9]{0,18}$/.test(telegramId || '') || !process.env.OPERATOR_ID) {
    throw new Error('Usage: OPERATOR_ID=... revoke-tokens TELEGRAM_USER_ID')
  }
  const [rows] = await sequelize.query(`UPDATE users SET token_version = token_version + 1
    WHERE telegram_id = :telegramId RETURNING public_id::text AS id, token_version`, { replacements: { telegramId } })
  if (!rows.length) throw new Error('User not found')
  console.log(JSON.stringify({ event: 'tokens_revoked', operator: process.env.OPERATOR_ID, user_id: rows[0].id, token_version: rows[0].token_version }))
} catch (error) { console.error(error.message); process.exitCode = 1 }
finally { await sequelize.close() }
