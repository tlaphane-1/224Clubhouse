import { test, expect } from '@playwright/test'

/**
 * Admin login e2e.
 *
 * The unauthenticated assertion (form renders) always runs. A REAL login is
 * only attempted when BOTH ADMIN_EMAIL and ADMIN_PASSWORD are present in the
 * environment — credentials are NEVER hardcoded. Without them, the login test
 * is skipped so CI without secrets stays green.
 *
 *   ADMIN_EMAIL=you@example.com ADMIN_PASSWORD=*** npm run test:e2e
 */

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem('age-verified', 'true')
    } catch {
      // ignore
    }
  })
})

test('admin login page shows the Sign In form with a password field', async ({ page }) => {
  await page.goto('/admin/login')

  await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible()
  // Password input is type=password (no label `for`, so target by type).
  await expect(page.locator('input[type="password"]')).toBeVisible()
  await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible()
})

test('admin can log in and reach the dashboard', async ({ page }) => {
  const email = process.env.ADMIN_EMAIL
  const password = process.env.ADMIN_PASSWORD
  test.skip(!email || !password, 'Set ADMIN_EMAIL and ADMIN_PASSWORD to run the real admin login test')

  await page.goto('/admin/login')

  await page.locator('input[type="email"]').fill(email)
  await page.locator('input[type="password"]').fill(password)
  await page.getByRole('button', { name: /sign in/i }).click()

  // On success the app navigates to /admin/dashboard.
  await page.waitForURL(/\/admin\/dashboard/, { timeout: 30_000 })
  expect(page.url()).toContain('/admin/dashboard')
})
