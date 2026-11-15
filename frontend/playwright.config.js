import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: './tests/e2e',
  outputDir: './tests/test-results',
  fullyParallel: true,
  use: { baseURL: 'http://127.0.0.1:5189', headless: true },
  webServer: { command: 'npm run dev -- --host 127.0.0.1 --port 5189 --strictPort', url: 'http://127.0.0.1:5189/tests/e2e/fixtures/fixture.html', reuseExistingServer: false },
})
