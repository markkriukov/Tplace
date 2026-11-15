import { sequelize } from '../../../db/sequelize.js'
import { createHttpError } from '../../../http/errors.js'
import { giftBlocked } from './custody-action-blocks.service.js'
import { custodySettings } from '../../../config.js'

// Call after locking the gift, in the transaction that mutates the trade.
// One query reads the block, an active withdrawal and the custodian's latest
// observation, which it share-locks against a concurrent custody sync.
export async function assertGiftInCustody(giftId, transaction) {
  const { configured, telegramUserId: custodian, maxAgeSeconds: maxAge } = custodySettings()
  const [[state]] = await sequelize.query(`
    SELECT g.is_test_import,
      EXISTS (SELECT 1 FROM gift_action_blocks b WHERE b.fk_gift_id = g.pk_gift_id) AS blocked,
      EXISTS (SELECT 1 FROM gift_withdrawals w WHERE w.fk_gift_id = g.pk_gift_id
        AND w.status IN ('queued','sending','review')) AS withdrawing,
      c.is_present, c.custodian, c.fresh
    FROM gifts g
    LEFT JOIN LATERAL (
      SELECT o.is_present, u.telegram_id::text AS custodian,
        GREATEST(o.confirmed_at, s.completed_at) >= now() - :maxAge * interval '1 second' AS fresh
      FROM gift_custody_observations o JOIN users u ON u.pk_user_id = o.fk_custodian_user_id
      LEFT JOIN gift_custody_snapshots s ON s.fk_user_id = o.fk_custodian_user_id
      WHERE o.fk_gift_id = g.pk_gift_id
      FOR SHARE OF o
    ) c ON true
    WHERE g.pk_gift_id = :giftId
  `, { replacements: { giftId, maxAge }, transaction })
  if (state?.blocked) throw giftBlocked()
  if (state?.withdrawing) throw createHttpError(409, 'Gift withdrawal is in progress', 'WITHDRAWAL_IN_PROGRESS')
  if (state?.is_test_import === true) return
  if (!configured) throw createHttpError(503, 'Gift custody is not configured', 'CUSTODY_NOT_CONFIGURED')
  if (!state?.is_present || !state.fresh || state.custodian !== custodian) {
    throw createHttpError(409, 'Gift is not available in custody', 'GIFT_UNAVAILABLE')
  }
}
