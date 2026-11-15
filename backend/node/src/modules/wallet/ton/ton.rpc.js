import axios from 'axios'
import { TonClient } from '@ton/ton'

// Pace individual HTTP requests: getSeqno() itself makes two RPC calls.
// Keep failed requests in the schedule and let the payment worker retry them.
export function pacedRpcAdapter({ adapter = axios.getAdapter('http'), intervalMs = 1100,
  now = Date.now, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  let queue = Promise.resolve()
  let nextRequestAt = 0
  return (request) => {
    const result = queue.then(async () => {
      const delay = nextRequestAt - now()
      if (delay > 0) await sleep(delay)
      try { return await adapter(request) }
      finally { nextRequestAt = now() + intervalMs }
    })
    queue = result.then(() => {}, () => {})
    return result
  }
}

// Reuse the limiter across clients in this process. Multiple API instances
// should use an RPC API key with capacity for their combined traffic.
const anonymousAdapters = new Map()

export function createTonRpcClient(config) {
  let httpAdapter
  if (!config.apiKey) {
    if (!anonymousAdapters.has(config.endpoint)) anonymousAdapters.set(config.endpoint, pacedRpcAdapter())
    httpAdapter = anonymousAdapters.get(config.endpoint)
  }
  return new TonClient({ endpoint: config.endpoint, apiKey: config.apiKey, timeout: 12000, httpAdapter })
}
