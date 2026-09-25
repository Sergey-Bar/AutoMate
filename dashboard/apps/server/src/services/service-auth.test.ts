import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildServiceAuthHeaders, requireServiceAuth } from './service-auth.js';

async function createApp() {
  const app = Fastify();
  app.get('/protected', { preHandler: requireServiceAuth }, async () => ({ ok: true }));
  await app.ready();
  return app;
}

describe('service auth', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns 401 when no header present', async () => {
    vi.stubEnv('AUTOMATE_SERVICE_SECRET', 'test-secret');
    const app = await createApp();

    const res = await app.inject({ method: 'GET', url: '/protected' });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'Service authentication required' });
    expect(res.body).not.toContain('test-secret');

    await app.close();
  });

  it('returns 403 when wrong secret in x-service-secret header', async () => {
    vi.stubEnv('AUTOMATE_SERVICE_SECRET', 'test-secret');
    const app = await createApp();

    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: buildServiceAuthHeaders('wrong-secret'),
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'Invalid service secret' });
    expect(res.body).not.toContain('test-secret');
    expect(res.body).not.toContain('wrong-secret');

    await app.close();
  });

  it('allows request when correct secret in x-service-secret header', async () => {
    vi.stubEnv('AUTOMATE_SERVICE_SECRET', 'test-secret');
    const app = await createApp();

    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: buildServiceAuthHeaders('test-secret'),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });

    await app.close();
  });

  it('allows request when correct secret in Authorization bearer header', async () => {
    vi.stubEnv('AUTOMATE_SERVICE_SECRET', 'test-secret');
    const app = await createApp();

    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: 'Bearer test-secret' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });

    await app.close();
  });

  it('returns 503 when AUTOMATE_SERVICE_SECRET is not set', async () => {
    vi.stubEnv('AUTOMATE_SERVICE_SECRET', '');
    const app = await createApp();

    const res = await app.inject({ method: 'GET', url: '/protected' });

    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: 'Service auth not configured' });
    expect(res.body).not.toContain('test-secret');

    await app.close();
  });
});
