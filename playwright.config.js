import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright e2e config for the 224 Clubhouse storefront.
 *
 * Targets a DEPLOYED build by default (no local web server is started) so the
 * suite can smoke-test production or a preview URL. Override the target with:
 *   PLAYWRIGHT_BASE_URL=http://localhost:5173 npm run test:e2e
 *
 * One-time setup: `npx playwright install chromium` (downloads the browser).
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'list',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'https://224clubhouse.web.app',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
