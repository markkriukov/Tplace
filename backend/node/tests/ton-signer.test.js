import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mnemonicNew, mnemonicToPrivateKey } from '@ton/crypto'
import { WalletContractV4, WalletContractV5R1 } from '@ton/ton'
import { internal, SendMode } from '@ton/core'
import { Blockchain } from '@ton/sandbox'
import { deriveTreasurySigner } from '../src/modules/wallet/ton/ton.signer.js'
import { getTonConfig } from '../src/modules/wallet/ton/ton.config.js'

test('12 and 24 BIP39 words derive the standard Tonkeeper account and can sign a transfer', async () => {
  // Public zero-entropy BIP39 fixtures. Expected keys were independently derived
  // with Node crypto PBKDF2/HMAC/Ed25519, without bip39 or @ton/crypto.
  const fixtures = [
    { count: 12, last: 'about', publicKey: '7952e94118f34607c75e23258dd9220d66ccac5a3ee074125c25068e8107bfbf' },
    { count: 24, last: 'art', publicKey: 'c6d2c947e552974c9f739fd7a02652519b8eef8cb9eef7867ac2e8f85777f244' },
  ]
  const chain = await Blockchain.create()
  const funder = await chain.treasury('bip39-signer-test')
  for (const fixture of fixtures) {
    const mnemonic = [...Array(fixture.count - 1).fill('abandon'), fixture.last].join(' ')
    const publicKey = Buffer.from(fixture.publicKey, 'hex')
    for (const contract of [WalletContractV4.create({ workchain: 0, publicKey }), WalletContractV5R1.create({ publicKey })]) {
      const signer = await deriveTreasurySigner({ mnemonic: `  ${mnemonic.toUpperCase().replaceAll(' ', '  ')}\n`,
        address: contract.address.toString({ bounceable: false }), network: '-239' })
      assert.equal(signer.scheme, 'bip39')
      assert.equal(signer.keys.publicKey.toString('hex'), fixture.publicKey)
      await funder.send({ to: contract.address, value: 1_000_000_000n, bounce: false })
      const wallet = chain.openContract(signer.contract)
      await wallet.send(wallet.createTransfer({ seqno: 0, secretKey: signer.keys.secretKey,
        sendMode: SendMode.PAY_GAS_SEPARATELY | SendMode.IGNORE_ERRORS,
        messages: [internal({ to: funder.address, value: 100_000_000n, bounce: false })] }))
      assert.equal(await wallet.getSeqno(), 1)
      signer.keys.secretKey.fill(0)
    }
    await assert.rejects(deriveTreasurySigner({ mnemonic, address: '0:' + '11'.repeat(32), network: '-239' }),
      { message: 'TREASURY_ADDRESS_MISMATCH' })
  }
  await assert.rejects(deriveTreasurySigner({ mnemonic: Array(12).fill('abandon').join(' '),
    address: '0:' + '11'.repeat(32), network: '-239' }), { message: 'INVALID_MNEMONIC' })
})

test('payout key import preserves the address and identifies V4R2 or V5R1 on the selected network', async () => {
  const words = await mnemonicNew(24)
  const mnemonic = words.join(' ')
  const keys = await mnemonicToPrivateKey(words)
  const v4 = WalletContractV4.create({ workchain: 0, publicKey: keys.publicKey })
  const v5 = WalletContractV5R1.create({ publicKey: keys.publicKey })
  const chain = await Blockchain.create()
  const funder = await chain.treasury('payout-signer-test')
  for (const [version, contract] of [['V4R2', v4], ['V5R1', v5]]) {
    const signer = await deriveTreasurySigner({ mnemonic, address: contract.address.toRawString(), network: '-239' })
    assert.equal(signer.version, version)
    assert.ok(signer.contract.address.equals(contract.address))
    await funder.send({ to: contract.address, value: 2_000_000_000n, bounce: false })
    const wallet = chain.openContract(signer.contract)
    const makeTransfer = (seqno) => wallet.createTransfer({
      seqno, secretKey: signer.keys.secretKey, timeout: Math.floor(Date.now() / 1000) + 600,
      sendMode: SendMode.PAY_GAS_SEPARATELY | SendMode.IGNORE_ERRORS,
      messages: [internal({ to: funder.address, value: 100_000_000n, bounce: false })],
    })
    await wallet.send(makeTransfer(0))
    assert.equal(await wallet.getSeqno(), 1)
    await wallet.send(makeTransfer(1))
    assert.equal(await wallet.getSeqno(), 2)
    signer.keys.secretKey.fill(0)
  }
  await assert.rejects(deriveTreasurySigner({ mnemonic, address: '0:' + '11'.repeat(32), network: '-239' }), { message: 'TREASURY_ADDRESS_MISMATCH' })
  await assert.rejects(deriveTreasurySigner({ mnemonic, address: v5.address.toRawString(), network: '-3' }), { message: 'TREASURY_ADDRESS_MISMATCH' })
  await assert.rejects(deriveTreasurySigner({ mnemonic: 'invalid', address: v4.address.toRawString(), network: '-239' }), { message: 'INVALID_MNEMONIC' })
  keys.secretKey.fill(0)
})

test('API reads a local secret file and honors the payout readiness flag', () => {
  const directory = mkdtempSync(join(tmpdir(), 'tplace-payout-config-'))
  const path = join(directory, 'test-secret')
  writeFileSync(path, 'synthetic-test-secret\n', { mode: 0o600 })
  try {
    const config = getTonConfig({ TON_TREASURY_MNEMONIC_FILE: path, TON_PAYOUTS_ENABLED: 'false' })
    assert.equal(config.mnemonic, 'synthetic-test-secret')
    assert.equal(config.payoutsEnabled, false)
    assert.equal(getTonConfig({ TON_TREASURY_MNEMONIC: 'synthetic-inline-secret' }).mnemonic, 'synthetic-inline-secret')
    assert.equal(getTonConfig({}).payoutsEnabled, true)
  } finally { unlinkSync(path); rmdirSync(directory) }
})

test('relative signing secret paths resolve from backend/node after moving TON modules', () => {
  const backendDirectory = fileURLToPath(new URL('../', import.meta.url))
  const directory = mkdtempSync(join(backendDirectory, '.ton-config-test-'))
  const path = join(directory, 'test-secret')
  writeFileSync(path, 'synthetic-relative-secret\n', { mode: 0o600 })
  try {
    const config = getTonConfig({
      TON_TREASURY_MNEMONIC_FILE: relative(backendDirectory, path),
      TON_PAYOUTS_ENABLED: 'false',
    })
    assert.equal(config.mnemonic, 'synthetic-relative-secret')
    assert.equal(config.payoutsEnabled, false)
  } finally { unlinkSync(path); rmdirSync(directory) }
})
