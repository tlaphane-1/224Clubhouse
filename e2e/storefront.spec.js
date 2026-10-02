import { test, expect } from '@playwright/test'

/**
 * Storefront browse path e2e.
 *
 * The site renders a global 21+ AgeGate overlay (z-9999) until the visitor
 * confirms; nothing underneath is clickable while it's up. dismissAgeGate()
 * clears it both via the localStorage flag (fast, deterministic) and by
 * clicking the button if the overlay is still showing.
 *
 * Selectors are intentionally resilient (roles + visible text), not CSS
 * classes, so a styling refactor doesn't break the suite.
 */

// Pre-seed the age-gate flag so the overlay never blocks navigation, then
// also click through it if it somehow renders (belt and braces).
async function dismissAgeGate(page) {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem('age-verified', 'true')
    } catch {
      // ignore — storage may be unavailable in some contexts
    }
  })
}

test.beforeEach(async ({ page }) => {
  await dismissAgeGate(page)
})

test('store page lists products with images', async ({ page }) => {
  await page.goto('/store')

  // If the gate still appears (e.g. init script raced), click through it.
  const yesBtn = page.getByRole('button', { name: /yes, i'?m 21/i })
  if (await yesBtn.isVisible().catch(() => false)) {
    await yesBtn.click()
  }

  await expect(page.getByRole('heading', { name: /the store/i })).toBeVisible()

  // Product cards link to /store/<slug> — wait for at least one to render.
  const productLink = page.locator('a[href^="/store/"]').first()
  await expect(productLink).toBeVisible()

  // At least one product image should load.
  const productImg = productLink.locator('img').first()
  await expect(productImg).toBeVisible()
})

test('product detail shows Add to Cart and clicking it increments the cart', async ({ page }) => {
  await page.goto('/store')

  const yesBtn = page.getByRole('button', { name: /yes, i'?m 21/i })
  if (await yesBtn.isVisible().catch(() => false)) {
    await yesBtn.click()
  }

  // Open the first product's detail page.
  const productLink = page.locator('a[href^="/store/"]').first()
  await expect(productLink).toBeVisible()
  await productLink.click()

  // Detail page exposes an "Add to Cart" button (text includes the price).
  const addToCart = page.getByRole('button', { name: /add to cart/i })
  await expect(addToCart).toBeVisible()

  // The cart badge (a small count next to the bag icon) only renders once
  // the cart is non-empty. Assert it appears after adding.
  const cartLink = page.locator('a[href="/cart"]').first()
  await addToCart.click()

  // A numeric badge with "1" should now be visible inside the cart link.
  await expect(cartLink.getByText(/^\d+$/).first()).toBeVisible()
})
