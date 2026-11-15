const setColor = (webApp, method, color) => {
  if (!color || typeof webApp[method] !== 'function') return

  try {
    webApp[method](color)
  } catch (error) {
    // Cosmetic bridge failures must not unmount the application.
    console.warn(`[Telegram WebApp] ${method} failed`, error)
  }
}

export function updateTelegramAppearance(webApp, { headerColor, backgroundColor }) {
  if (!webApp) return
  const supportsVersion = version => webApp.isVersionAtLeast?.(version) === true
  if (typeof webApp.isVersionAtLeast === 'function' && !supportsVersion('6.1')) return

  // Before Bot API 6.9 the header only accepts Telegram theme colors.
  if (headerColor) {
    setColor(webApp, 'setHeaderColor', supportsVersion('6.9') ? headerColor : 'secondary_bg_color')
  }
  setColor(webApp, 'setBackgroundColor', backgroundColor)
}
