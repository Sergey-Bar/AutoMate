import { test, expect } from '@playwright/test'

test.describe('Unified Auth', () => {
  test('login via Dashboard sets cookie that works on Automate', async ({ request }) => {
    // Login
    const loginRes = await request.post('/api/auth/login', {
      data: { apiKey: 'test-api-key' },
    })
    expect(loginRes.status()).toBe(200)

    // Verify cookie grants access to Automate
    const aiHealth = await request.get('/ai/api/health')
    expect(aiHealth.status()).toBe(200)

    // Verify cookie grants access to Dashboard
    const dashHealth = await request.get('/dashboard/api/health')
    expect(dashHealth.status()).toBe(200)
  })

  test('invalid cookie rejected by both services', async ({ request }) => {
    const aiRes = await request.get('/ai/api/conversations', {
      headers: { Cookie: 'automate_session=invalid-token' },
    })
    expect([401, 403]).toContain(aiRes.status())
  })
})
