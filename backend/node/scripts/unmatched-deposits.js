import { sequelize } from '../src/db/sequelize.js'

// Inbound treasury transfers that credited no balance. Resolving only records
// the operator's decision; refunds or manual credits happen outside this tool.
const [action = 'list', id, ...noteParts] = process.argv.slice(2)
try {
  if (action === 'list') {
    const [rows] = await sequelize.query(`SELECT d.public_id::text AS id, d.reason, d.amount_nano::text, d.sender_address, d.memo,
      d.tx_hash, d.received_at, p.public_id::text AS payment_id, p.amount_nano::text AS invoice_amount_nano, p.wallet_address AS invoice_wallet
      FROM ton_unmatched_deposits d LEFT JOIN ton_payments p ON p.pk_payment_id = d.fk_payment_id
      WHERE d.status = 'open' ORDER BY d.pk_unmatched_deposit_id`)
    for (const row of rows) console.log(JSON.stringify(row))
    if (!rows.length) console.log('No open unmatched deposits.')
  } else if (action === 'resolve') {
    const actor = process.env.OPERATOR_ID
    const note = noteParts.join(' ')
    if (!/^[0-9a-f-]{36}$/i.test(id || '') || !actor || !note) {
      throw new Error('Usage: OPERATOR_ID=... unmatched-deposits resolve ID <how it was handled>')
    }
    const [rows] = await sequelize.query(`UPDATE ton_unmatched_deposits SET status = 'resolved', resolved_at = now(),
      resolution_note = :note WHERE public_id = :id AND status = 'open' RETURNING public_id`,
    { replacements: { id, note: `${actor}: ${note}` } })
    if (!rows.length) throw new Error('Open unmatched deposit not found')
    console.log('Resolved.')
  } else {
    throw new Error('Usage: unmatched-deposits list | resolve ID <note>')
  }
} catch (error) { console.error(error.message); process.exitCode = 1 }
finally { await sequelize.close() }
