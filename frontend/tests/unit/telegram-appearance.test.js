import assert from 'node:assert/strict'
import { test } from 'node:test'
import { updateTelegramAppearance } from '../../src/features/auth/lib/telegram-appearance.js'

const palette = { headerColor: '#121b27', backgroundColor: '#0b1018' }

for (const [version, expectedHeader] of [
  [6.1, 'secondary_bg_color'],
  [6.8, 'secondary_bg_color'],
  [6.9, palette.headerColor],
  [10, palette.headerColor],
]) {
  test(`Telegram API ${version} receives a supported header color`, () => {
    const calls = []
    updateTelegramAppearance({
      isVersionAtLeast: required => version >= Number(required),
      setHeaderColor: color => calls.push(['header', color]),
      setBackgroundColor: color => calls.push(['background', color]),
    }, palette)
    assert.deepEqual(calls, [['header', expectedHeader], ['background', palette.backgroundColor]])
  })
}

test('clients without color API support are left alone', () => {
  updateTelegramAppearance({
    isVersionAtLeast: () => false,
    setHeaderColor: () => assert.fail('unsupported call'),
    setBackgroundColor: () => assert.fail('unsupported call'),
  }, palette)
  updateTelegramAppearance({}, palette)
  updateTelegramAppearance(null, palette)
})

test('a header bridge error does not stop rendering or background customization', t => {
  const warning = t.mock.method(console, 'warn', () => {})
  const calls = []
  updateTelegramAppearance({
    isVersionAtLeast: () => true,
    setHeaderColor: () => { throw new Error('bridge unavailable') },
    setBackgroundColor: color => calls.push(color),
  }, palette)
  assert.deepEqual(calls, [palette.backgroundColor])
  assert.equal(warning.mock.callCount(), 1)
})
