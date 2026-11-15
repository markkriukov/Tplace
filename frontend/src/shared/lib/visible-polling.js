// Status reads only: never retry mutations here. One request at a time,
// paused when hidden/offline, with bounded backoff for temporary failures.
export function startVisiblePolling(task, {
  intervalMs, initialDelayMs = 0, maxDelayMs = 30_000, onError = () => {},
}) {
  let timer
  let controller
  let stopped = false
  let failures = 0
  const visible = () => document.visibilityState !== 'hidden' && navigator.onLine !== false
  const schedule = delay => {
    clearTimeout(timer)
    if (!stopped && visible()) timer = setTimeout(run, delay)
  }
  const run = async () => {
    if (stopped || controller || !visible()) return
    const current = new AbortController()
    controller = current
    let delay = intervalMs
    try {
      const keepGoing = await task(AbortSignal.any([current.signal, AbortSignal.timeout(15_000)]))
      if (current.signal.aborted || stopped) return
      failures = 0
      if (keepGoing === false) stopped = true
    } catch (error) {
      if (current.signal.aborted || stopped) return
      failures++
      delay = Math.min(maxDelayMs, intervalMs * 2 ** Math.min(failures, 10))
      onError(error)
    } finally {
      controller = null
      schedule(current.signal.aborted ? 0 : delay)
    }
  }
  const resume = () => {
    clearTimeout(timer)
    if (!visible()) controller?.abort()
    else if (!controller) schedule(0)
  }
  document.addEventListener('visibilitychange', resume)
  window.addEventListener('online', resume)
  window.addEventListener('offline', resume)
  window.addEventListener('focus', resume)
  schedule(initialDelayMs)
  return () => {
    stopped = true
    clearTimeout(timer)
    controller?.abort()
    document.removeEventListener('visibilitychange', resume)
    window.removeEventListener('online', resume)
    window.removeEventListener('offline', resume)
    window.removeEventListener('focus', resume)
  }
}
