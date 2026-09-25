import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { OrchestrationService } from '../services/orchestration-service.js';
import { createOrchestrationRoutes } from './orchestration.js';

describe('orchestration routes', () => {
  it('creates an automation, enqueues a job, and cancels it', async () => {
    const app = new Hono().route('/', createOrchestrationRoutes(new OrchestrationService()));
    const definition = { workspaceId: 'workspace-1', name: 'Playwright', tool: 'playwright' as const, toolVersion: '1.63.0', imageDigest: 'a'.repeat(64), input: {}, timeoutMs: 1000, maxAttempts: 1, requiredCapabilities: ['playwright'] };
    const created = await app.request('/api/v1/automations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(definition) });
    expect(created.status).toBe(201);
    const { automation } = await created.json() as { automation: { id: string } };
    const job = await app.request(`/api/v1/automations/${automation.id}/jobs`, { method: 'POST' });
    expect(job.status).toBe(202);
    const { job: envelope } = await job.json() as { job: { executionId: string } };
    const cancelled = await app.request(`/api/v1/jobs/${envelope.executionId}/cancel`, { method: 'POST' });
    expect(cancelled.status).toBe(200);
  });

  it('creates and lists schedules', async () => {
    const app = new Hono().route('/', createOrchestrationRoutes(new OrchestrationService()));
    const schedule = { automationId: 'automation-1', cron: '0 * * * *', timezone: 'UTC', enabled: true, misfirePolicy: 'run_once' as const };
    expect((await app.request('/api/v1/schedules', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(schedule) })).status).toBe(201);
    expect((await app.request('/api/v1/schedules')).status).toBe(200);
    expect((await app.request('/api/v1/schedules', { method: 'POST', body: '{}' })).status).toBe(400);
    expect((await app.request('/api/v1/automations', { method: 'POST', body: '{}' })).status).toBe(400);
    expect((await app.request('/api/v1/automations/missing/jobs', { method: 'POST' })).status).toBe(404);
    expect((await app.request('/api/v1/jobs/missing/cancel', { method: 'POST' })).status).toBe(404);
  });
});
