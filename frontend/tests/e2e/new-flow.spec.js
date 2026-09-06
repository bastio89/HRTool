import { test, expect } from '@playwright/test'

test('mein neuer test', async ({ page }) => {
  await page.goto('/login')
  await expect(page.getByRole('heading', { name: 'HR Systemm' })).toBeVisible()
})