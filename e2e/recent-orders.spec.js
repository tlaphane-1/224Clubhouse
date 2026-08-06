import { test, expect } from '@playwright/test'

test('track order shows orders placed on this device', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('age-verified', 'true')
    localStorage.setItem('224:recent-orders', JSON.stringify([
      { orderNumber: '224-ABC123', email: 'buyer@example.com', total: 450, itemCount: 2, placedAt: '2026-08-06T09:00:00Z' },
      { orderNumber: '224-XYZ789', email: 'buyer@example.com', total: 199, itemCount: 1, placedAt: '2026-08-01T09:00:00Z' },
    ]))
  })
  await page.goto('/track')
  await expect(page.getByRole('heading', { name: 'Your orders' })).toBeVisible()
  await expect(page.getByText('224-ABC123')).toBeVisible()
  await expect(page.getByText('224-XYZ789')).toBeVisible()


  // Newest first
  const nums = await page.locator('.font-mono').allInnerTexts()
  expect(nums[0]).toContain('224-ABC123')

  // Removing one clears it from the list
  await page.getByRole('button', { name: /Remove 224-XYZ789/ }).click()
  await expect(page.getByText('224-XYZ789')).toBeHidden()
})
