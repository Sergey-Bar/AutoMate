import { test, expect } from '@playwright/test'

test.describe('Cross-Service Communication', () => {
  test('trigger run via service-auth and receive callback', async ({ request }) => {
    // Trigger a run on Dashboard
    const triggerRes = await request.post('/dashboard/api/service/trigger-run', {
      headers: { 'X-Service-Auth': 'Bearer test-secret' },
      data: {
        specCode:
          "import { test, expect } from '@playwright/test'; test('basic', async () => { expect(1+1).toBe(2); });",
        specFileName: 'basic.spec.ts',
      },
    })
    expect(triggerRes.status()).toBe(202)
    const { runId } = await triggerRes.json()
    expect(runId).toBeTruthy()

    // Poll for run completion (max 30s)
    let status = 'running'
    for (let i = 0; i < 30 && status === 'running'; i++) {
      await new Promise((r) => setTimeout(r, 1000))
      const statusRes = await request.get(`/dashboard/api/runs/${runId}`, {
        headers: { 'X-Service-Auth': 'Bearer test-secret' },
      })
      if (statusRes.ok()) {
        const data = await statusRes.json()
        status = data.status
      }
    }
    expect(['completed', 'passed', 'failed']).toContain(status)
  })

  test('health/unified aggregates both services', async ({ request }) => {
    const res = await request.get('/health/unified', {
      headers: { 'X-Service-Auth': 'Bearer test-secret' },
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.automate).toBeDefined()
    expect(body.dashboard).toBeDefined()
  })

  test('run-callback stores result accessible via API', async ({ request }) => {
    // Simulate a callback from Dashboard
    const callbackRes = await request.post('/ai/api/service/run-callback', {
      headers: { 'X-Service-Auth': 'Bearer test-secret' },
      data: {
        runId: 'e2e-test-run-001',
        status: 'passed',
        total: 5,
        passed: 5,
        failed: 0,
      },
    })
    expect(callbackRes.status()).toBe(200)

    // Verify result stored
    const resultRes = await request.get('/ai/api/service/run-results/e2e-test-run-001', {
      headers: { 'X-Service-Auth': 'Bearer test-secret' },
    })
    expect(resultRes.status()).toBe(200)
    const result = await resultRes.json()
    expect(result.runId).toBe('e2e-test-run-001')
    expect(result.passed).toBe(5)
  })
})
