import { test, expect } from '@playwright/test'

test.describe('Shell Navigation', () => {
  test('shell serves at root and shows navigation', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('nav')).toBeVisible()
    await expect(page.getByText('AI Assistant')).toBeVisible()
    await expect(page.getByText('Dashboard')).toBeVisible()
  })

  test('nginx health endpoint responds', async ({ request }) => {
    const res = await request.get('/nginx-health')
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('ok')
  })
})
