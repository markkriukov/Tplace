import { Address } from '@ton/core'
import { WalletContractV4, WalletContractV5R1 } from '@ton/ton'
import { deriveEd25519Path, keyPairFromSeed, mnemonicToPrivateKey, mnemonicValidate } from '@ton/crypto'
import { mnemonicToSeed, validateMnemonic, wordlists } from 'bip39'

async function bip39Keys(mnemonic) {
  const seed = await mnemonicToSeed(mnemonic)
  let derived
  try {
    // Tonkeeper's BIP39 scheme: m/44'/607'/0', SLIP-0010 Ed25519.
    derived = await deriveEd25519Path(seed, [44, 607, 0])
    return keyPairFromSeed(derived)
  } finally { seed.fill(0); derived?.fill(0) }
}

export async function deriveTreasurySigner({ mnemonic, address, network }) {
  const words = String(mnemonic).trim().toLowerCase().split(/\s+/)
  if (![12, 24].includes(words.length)) throw new Error('INVALID_MNEMONIC')
  const phrase = words.join(' ')
  const schemes = []
  if (words.length === 24 && await mnemonicValidate(words)) {
    schemes.push({ scheme: 'ton', derive: () => mnemonicToPrivateKey(words) })
  }
  if (validateMnemonic(phrase, wordlists.english)) {
    schemes.push({ scheme: 'bip39', derive: () => bip39Keys(phrase) })
  }
  if (!schemes.length) throw new Error('INVALID_MNEMONIC')
  const expectedAddress = Address.parse(address)
  // A 24-word phrase can validate under both schemes. The configured address
  // selects the account; never replace it with another derived wallet.
  for (const { scheme, derive } of schemes) {
    const keys = await derive()
    let matched = false
    try {
      const candidates = [
        { version: 'V4R2', contract: WalletContractV4.create({ workchain: 0, publicKey: keys.publicKey }) },
        { version: 'V5R1', contract: WalletContractV5R1.create({ publicKey: keys.publicKey,
          walletId: { networkGlobalId: Number(network), context: { walletVersion: 'v5r1', workchain: 0, subwalletNumber: 0 } } }) },
      ]
      const match = candidates.find(({ contract }) => contract.address.equals(expectedAddress))
      if (match) { matched = true; return { ...match, keys, scheme } }
    } finally { if (!matched) keys.secretKey.fill(0) }
  }
  throw new Error('TREASURY_ADDRESS_MISMATCH')
}
