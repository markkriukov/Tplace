import { sequelize } from '../src/db/sequelize.js'
import { TonPayment } from '../src/db/models.js'
import { isPublicId } from '../src/http/public-id.js'
import { getTonConfig } from '../src/modules/wallet/ton/ton.config.js'
import { createTonGateway } from '../src/modules/wallet/ton/ton.gateway.js'
import { settlePayment } from '../src/modules/wallet/payments/payments.service.js'

// No refund/re-sign override: a proven receipt is required to release this queue.
const [publicId, action = 'inspect', ...noteParts] = process.argv.slice(2)
const audit = (payment, actor, auditAction, note) => sequelize.query(
  'INSERT INTO payment_review_audit(fk_payment_id, actor, action, note) VALUES (:payment,:actor,:action,:note)',
  { replacements: { payment: payment.pk_payment_id, actor, action: auditAction, note } })
try {
  if (!isPublicId(publicId) || !['inspect', 'recheck'].includes(action)) throw new Error('Usage: payment-review PAYMENT_ID inspect|recheck [operator note]')
  const payment = await TonPayment.findOne({ where: { public_id: publicId.toLowerCase() } })
  if (!payment) throw new Error('Payment not found')
  if (action === 'inspect') {
    console.log(JSON.stringify({ id: payment.public_id, status: payment.status, kind: payment.kind,
      created_at: payment.created_at, updated_at: payment.updated_at, tx_hash: payment.tx_hash }))
  } else {
    const actor = process.env.OPERATOR_ID
    const note = noteParts.join(' ')
    if (!actor || !note) throw new Error('OPERATOR_ID and an investigation note are required')
    const config = getTonConfig()
    if (payment.network !== config.network || payment.treasury_address !== config.address) throw new Error('Treasury configuration does not match payment')
    await audit(payment, actor, 'recheck_requested', note)
    const hash = await createTonGateway(config).findReceipt(payment)
    const overLimit = hash ? await settlePayment(payment.pk_payment_id, hash) === 'balance_limit' : false
    await audit(payment, actor, !hash ? 'receipt_missing' : overLimit ? 'balance_limit' : 'receipt_confirmed',
      hash || 'Reservation retained; investigate chain/RPC availability')
    console.log(!hash ? 'No receipt found. Reservation and queue remain held.'
      : overLimit ? 'Receipt confirmed, but the deposit exceeds the balance limit and was not credited.'
        : 'Receipt confirmed; settlement is idempotent.')
  }
} catch (error) { console.error(error.message); process.exitCode = 1 }
finally { await sequelize.close() }
