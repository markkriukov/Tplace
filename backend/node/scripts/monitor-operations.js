import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { logError } from '../src/log.js'

let stopped = false
let timer
let child
const tick = () => {
  child = spawn(process.execPath, [fileURLToPath(new URL('./check-operations.js', import.meta.url))], { stdio: 'inherit' })
  child.once('error', error => logError('operations_monitor_failed', error))
  child.once('close', () => { if (!stopped) timer = setTimeout(tick, 60000) })
}
const stop = () => { stopped = true; clearTimeout(timer); child?.kill('SIGTERM') }
process.on('SIGTERM', stop)
process.on('SIGINT', stop)
tick()
