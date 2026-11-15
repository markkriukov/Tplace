// Bundled artwork shown while a gift or news image is missing or fails to load.
export const GIFT_PLACEHOLDER_IMAGES = ['/gifts/crystal-fox.svg', '/gifts/cyber-bloom.svg', '/gifts/lunar-toy.svg', '/gifts/signal-orb.svg']
export const DEFAULT_PLACEHOLDER_IMAGE = '/gifts/signal-orb.svg'

/** A stable placeholder for an entity, so a list does not show one image everywhere. */
export function placeholderImageFor(seed) {
  if (!seed) return DEFAULT_PLACEHOLDER_IMAGE
  const hash = [...String(seed)].reduce((sum, character) => sum + character.charCodeAt(0), 0)
  return GIFT_PLACEHOLDER_IMAGES[hash % GIFT_PLACEHOLDER_IMAGES.length]
}
