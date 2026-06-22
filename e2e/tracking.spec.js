import { test, expect } from '@playwright/test'

/**
 * Order tracking page e2e (the COD "track by order number + email" flow).
 *
 * Only the STABLE not-found path is asserted here — it doesn't depend on a
 * real order existing and is safe to run against any environment. A bogus
 * order number + email must surface the "couldn't find" message and never
 * leak someone else's order.
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

test('track page shows the order-number + email lookup form', async ({ page }) => {
  await page.goto('/track')

  await expect(page.getByRole('heading', { name: /track your order/i })).toBeVisible()

  // Both inputs are labelled; target them by accessible label.
  await expect(page.getByLabel(/order number/i)).toBeVisible()
  await expect(page.getByLabel(/email/i)).toBeVisible()
  await expect(page.getByRole('button', { name: /track order/i })).toBeVisible()
})

test('bogus order number + email shows the not-found message', async ({ page }) => {
  await page.goto('/track')

  await page.getByLabel(/order number/i).fill('224-ZZZZZZ')
  await page.getByLabel(/email/i).fill('nobody+e2e@example.com')
  await page.getByRole('button', { name: /track order/i }).click()

  // The not-found copy from TrackOrder.jsx.
  await expect(page.getByText(/couldn'?t find an order/i)).toBeVisible()
})
