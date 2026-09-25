import { test, expect } from '@playwright/test'

test.describe('API Routing via Nginx', () => {
  test('/ai/health proxies to Automate', async ({ request }) => {
    const res = await request.get('/ai/health')
    expect(res.status()).toBe(200)
  })

  test('/dashboard/health proxies to Dashboard', async ({ request }) => {
    const res = await request.get('/dashboard/health')
    expect(res.status()).toBe(200)
  })

  test('/ai/api/ routes to Automate API', async ({ request }) => {
    const res = await request.get('/ai/api/health')
    expect(res.status()).toBe(200)
  })

  test('/dashboard/api/ routes to Dashboard API', async ({ request }) => {
    const res = await request.get('/dashboard/api/health')
    expect(res.status()).toBe(200)
  })
})
