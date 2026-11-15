export const marketEvents = new EventTarget()

export function notifyMarketChanged() {
  marketEvents.dispatchEvent(new Event('change'))
}
