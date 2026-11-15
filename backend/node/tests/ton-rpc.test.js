import test from 'node:test'
import assert from 'node:assert/strict'
import { TonClient, WalletContractV5R1 } from '@ton/ton'
import { pacedRpcAdapter } from '../src/modules/wallet/ton/ton.rpc.js'

test('anonymous RPC serializes concurrent calls and recovers after a failed request', async () => {
  let clock = 0
  const starts = []
  const request = pacedRpcAdapter({ now: () => clock, sleep: async (ms) => { clock += ms },
    adapter: async (config) => {
      starts.push(clock)
      clock += 20
      if (config.fail) throw new Error('synthetic 429')
      return config.id
    } })
  const results = await Promise.allSettled([request({ id: 1 }), request({ fail: true }), request({ id: 3 })])
  assert.deepEqual(starts, [0, 1120, 2240])
  assert.equal(results[0].value, 1)
  assert.equal(results[1].status, 'rejected')
  assert.equal(results[2].value, 3)
})

test('V5 getSeqno internal requests and signature checks respect the anonymous RPC limit', async () => {
  let clock = 0
  const calls = []
  const httpAdapter = pacedRpcAdapter({ now: () => clock, sleep: async (ms) => { clock += ms },
    adapter: async (config) => {
      const request = JSON.parse(config.data)
      calls.push({ method: request.method, at: clock })
      const result = request.method === 'getAddressInformation' ? {
        balance: '100000000', state: 'active', code: '', data: '',
        last_transaction_id: { '@type': 'internal.transactionId', lt: '0', hash: '' },
        block_id: { '@type': 'ton.blockIdExt', workchain: 0, shard: '0', seqno: 1, root_hash: '', file_hash: '' },
        sync_utime: 0,
      } : { gas_used: 0, exit_code: 0, stack: [['num', request.params.method === 'seqno' ? '0x1' : '-0x1']] }
      return { config, status: 200, statusText: 'OK', headers: {}, data: JSON.stringify({ ok: true, result }) }
    } })
  const client = new TonClient({ endpoint: 'https://rpc.invalid', httpAdapter })
  const wallet = client.open(WalletContractV5R1.create({ publicKey: Buffer.alloc(32, 1) }))
  assert.equal(await wallet.getSeqno(), 1)
  assert.equal(await wallet.getIsSecretKeyAuthEnabled(), true)
  assert.deepEqual(calls, [
    { method: 'getAddressInformation', at: 0 },
    { method: 'runGetMethod', at: 1100 },
    { method: 'runGetMethod', at: 2200 },
  ])
})
