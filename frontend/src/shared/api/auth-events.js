export const authEvents = new EventTarget()

export function notifyAuthExpired(token) {
  if (token) authEvents.dispatchEvent(new CustomEvent('expired', { detail: token }))
}
