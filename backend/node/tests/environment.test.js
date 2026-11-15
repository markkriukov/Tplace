import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'

function withEnvironmentFixture(run) {
  const temporaryDirectory = realpathSync(tmpdir())
  const root = mkdtempSync(join(temporaryDirectory, 'tplace-environment-'))
  const backend = join(root, 'backend', 'node')
  const scripts = join(backend, 'scripts')
  mkdirSync(scripts, { recursive: true })
  writeFileSync(join(root, 'package.json'), '{"type":"module"}')
  const preload = join(scripts, 'load-environment.js')
  copyFileSync(new URL('../scripts/load-environment.js', import.meta.url), preload)
  const entry = join(backend, 'entry.js')
  try { run({ root, backend, preload: pathToFileURL(preload).href, entry }) }
  finally {
    assert.equal(dirname(root), temporaryDirectory)
    rmSync(root, { recursive: true, force: true })
  }
}

test('shared env loads before application imports and preserves process overrides', () => {
  withEnvironmentFixture(({ root, backend, preload, entry }) => {
    writeFileSync(join(root, '.env'), 'TPLACE_ENV_TEST_VALUE=from-root\nTPLACE_ENV_TEST_OVERRIDE=from-file\n')
    writeFileSync(join(backend, 'settings.js'), 'export const value = process.env.TPLACE_ENV_TEST_VALUE\n')
    writeFileSync(entry, `
      import assert from 'node:assert/strict'
      import { value } from './settings.js'
      assert.equal(value, 'from-root')
      assert.equal(process.env.TPLACE_ENV_TEST_OVERRIDE, 'from-process')
      console.log('ENVIRONMENT_READY')
    `)
    const result = spawnSync(process.execPath, ['--import', preload, entry], {
      cwd: backend, encoding: 'utf8', timeout: 5000,
      env: { ...process.env, TPLACE_ENV_TEST_OVERRIDE: 'from-process' },
    })
    assert.ifError(result.error)
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /ENVIRONMENT_READY/)
  })
})

test('watch mode starts without a root env file', () => {
  withEnvironmentFixture(({ backend, preload, entry }) => {
    writeFileSync(entry, "console.log('WATCH_READY')\n")
    const result = spawnSync(process.execPath, ['--import', preload, '--watch', entry], {
      cwd: backend, encoding: 'utf8', timeout: 5000,
    })
    // A healthy watcher remains running after the fixture exits; timeout ends it.
    assert.equal(result.error?.code, 'ETIMEDOUT')
    assert.match(result.stdout, /WATCH_READY/)
    assert.doesNotMatch(result.stdout + result.stderr, /ENOENT|not found|Error:/)
  })
})
