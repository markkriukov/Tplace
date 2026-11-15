import { sequelize } from '../../../db/sequelize.js'
import { createHttpError } from '../../../http/errors.js'

export function giftBlocked() {
  return createHttpError(409, 'Gift is blocked because of a duplicate real deposit', 'GIFT_BLOCKED')
}

// Mutating callers hold the gift row lock, also taken by deposit registration.
export async function isGiftBlocked(giftId, transaction) {
  const [rows] = await sequelize.query('SELECT 1 FROM gift_action_blocks WHERE fk_gift_id=:giftId', {
    replacements: { giftId }, transaction,
  })
  return rows.length > 0
}

export async function assertGiftNotBlocked(giftId, transaction) {
  if (await isGiftBlocked(giftId, transaction)) throw giftBlocked()
}
