import { logError } from './log.js'

/** Runs `task` now and then `intervalMs` after each run ends. The returned
 * function stops the loop and waits for a run in progress. */
export function startPollingWorker(task, { intervalMs, errorEvent }) {
  let stopped = false
  let timer
  let running
  const tick = () => {
    running = task()
      .catch(error => logError(errorEvent, error))
      .finally(() => { if (!stopped) { timer = setTimeout(tick, intervalMs); timer.unref() } })
  }
  tick()
  return async () => { stopped = true; clearTimeout(timer); await running }
}
