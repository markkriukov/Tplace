import test from 'node:test'
import assert from 'node:assert/strict'
import { startVisiblePolling } from '../../src/shared/lib/visible-polling.js'

function environment(t) {
  const cleanup = []
  t.after(() => cleanup.forEach(stop => stop()))
  const document = Object.assign(new EventTarget(), { visibilityState: 'visible' })
  const window = new EventTarget()
  const navigator = { onLine: true }
  for (const [key, value] of Object.entries({ document, window, navigator })) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key)
    Object.defineProperty(globalThis, key, { value, configurable: true })
    t.after(() => descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key])
  }
  let id = 0
  const timers = new Map()
  t.mock.method(globalThis, 'setTimeout', (fn, delay) => { timers.set(++id, { fn, delay }); return id })
  t.mock.method(globalThis, 'clearTimeout', key => timers.delete(key))
  const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve() }
  return { document, window, navigator, timers, flush, cleanup,
    async tick(delay) {
      assert.equal(timers.size, 1)
      const [key, timer] = timers.entries().next().value
      assert.equal(timer.delay, delay)
      timers.delete(key)
      timer.fn()
      await flush()
    },
  }
}

test('polling backs off failures, resets on recovery and stops on terminal status', async t => {
  const env = environment(t)
  let fail = true
  let terminal = false
  let errors = 0
  const stop = startVisiblePolling(async () => {
    if (fail) throw new Error('unavailable')
    return !terminal
  }, { intervalMs: 2000, initialDelayMs: 1000, onError: () => errors++ })
  env.cleanup.push(stop)
  for (const delay of [1000, 4000, 8000, 16000, 30000]) await env.tick(delay)
  assert.equal(errors, 5)
  fail = false
  await env.tick(30000)
  terminal = true
  await env.tick(2000)
  assert.equal(env.timers.size, 0)
  env.document.dispatchEvent(new Event('visibilitychange'))
  assert.equal(env.timers.size, 0)
})

test('hidden/offline polling cancels reads, resumes once and never overlaps requests', async t => {
  const env = environment(t)
  let release
  let signal
  let calls = 0
  const stop = startVisiblePolling(current => {
    signal = current
    calls++
    return new Promise(resolve => { release = resolve })
  }, { intervalMs: 2000 })
  env.cleanup.push(stop)
  await env.tick(0)
  env.document.dispatchEvent(new Event('visibilitychange'))
  assert.equal(env.timers.size, 0)
  env.document.visibilityState = 'hidden'
  env.document.dispatchEvent(new Event('visibilitychange'))
  assert.equal(signal.aborted, true)
  release()
  await env.flush()
  assert.equal(env.timers.size, 0)
  env.document.visibilityState = 'visible'
  env.document.dispatchEvent(new Event('visibilitychange'))
  await env.tick(0)
  assert.equal(calls, 2)
  env.navigator.onLine = false
  env.window.dispatchEvent(new Event('offline'))
  assert.equal(signal.aborted, true)
  release()
  await env.flush()
  assert.equal(env.timers.size, 0)
  env.navigator.onLine = true
  env.window.dispatchEvent(new Event('online'))
  await env.tick(0)
  stop()
  assert.equal(signal.aborted, true)
  release()
  await env.flush()
  env.window.dispatchEvent(new Event('online'))
  assert.equal(env.timers.size, 0)
})
