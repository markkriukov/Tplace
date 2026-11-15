export async function mockTelegram(page, { platform = 'unknown', initData = '', version = '10.0' } = {}) {
  await page.route('https://telegram.org/js/telegram-web-app.js*', route => route.fulfill({
    contentType: 'application/javascript',
    body: `window.Telegram = { WebApp: {
      platform: ${JSON.stringify(platform)},
      version: ${JSON.stringify(version)},
      isVersionAtLeast(required) { return Number(this.version) >= Number(required); },
      initData: ${JSON.stringify(initData)},
      initDataUnsafe: ${JSON.stringify(initData ? { user: { id: 123, username: 'tester' } } : {})},
      isExpanded: true,
      onEvent() {}, offEvent() {}, ready() {},
      setHeaderColor(color) {
        if (!this.isVersionAtLeast('6.9') && color !== 'bg_color' && color !== 'secondary_bg_color') {
          throw new Error('WebAppHeaderColorKeyInvalid');
        }
      },
      setBackgroundColor() {}
    } };`,
  }))
}

