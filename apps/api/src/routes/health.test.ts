import { describe, expect, it } from 'vitest';
import { createHealthRoutes } from './health.js';

describe('health and readiness routes', () => {
  it('keeps liveness public and gates readiness on the database', async () => {
    const app = createHealthRoutes();
    const live = await app.request('/api/v1/health');
    expect(live.status).toBe(200);
    expect((await live.json()) as { status: string }).toMatchObject({ status: 'healthy' });
    const notReady = await app.request('/api/v1/ready');
    expect(notReady.status).toBe(503);
    expect((await notReady.json()) as { status: string }).toMatchObject({ status: 'not_ready' });

    const ready = createHealthRoutes({
      databaseUrl: 'postgres://ready',
      checkDatabase: async () => undefined,
    });
    const response = await ready.request('/api/v1/ready');
    expect(response.status).toBe(200);
    expect((await response.json()) as { status: string }).toMatchObject({ status: 'ready' });
  });
});
