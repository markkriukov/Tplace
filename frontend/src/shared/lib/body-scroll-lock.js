let locks = 0
let previousOverflowY = ''

export function lockBodyScroll(body = globalThis.document?.body) {
  if (!body) return () => {}
  if (locks === 0) previousOverflowY = body.style.overflowY
  locks += 1
  body.style.overflowY = 'hidden'
  let released = false
  return () => {
    if (released) return
    released = true
    locks -= 1
    if (locks === 0) body.style.overflowY = previousOverflowY
  }
}
