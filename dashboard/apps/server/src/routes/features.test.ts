import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { featuresRoutes } from './features.js';

describe('GET /api/features', () => {
  it('returns feature flags as JSON object', async () => {
    const app = Fastify();
    await featuresRoutes(app);
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/api/features' });
    expect(res.statusCode).toBe(200);

    const body = JSON.parse(res.payload);
    expect(body).toHaveProperty('live-run-monitoring');
    expect(typeof body['live-run-monitoring']).toBe('boolean');
    expect(body).toHaveProperty('auto-quarantine');
  });
});
