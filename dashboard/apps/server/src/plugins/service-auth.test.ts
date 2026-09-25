import { afterEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerServiceAuthPlugin } from './service-auth.js';

async function buildApp(serviceSecret?: string): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await registerServiceAuthPlugin(app, { serviceSecret });
  await app.ready();
  return app;
}

describe('registerServiceAuthPlugin', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app?.close();
  });

  it('allows valid service auth token', async () => {
    app = await buildApp('test-secret-123');

    const res = await app.inject({
      method: 'GET',
      url: '/api/service/ping',
      headers: { 'x-service-auth': 'Bearer test-secret-123' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ pong: true });
  });

  it('rejects missing service auth header', async () => {
    app = await buildApp('test-secret-123');

    const res = await app.inject({ method: 'GET', url: '/api/service/ping' });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'Missing service authentication' });
  });

  it('rejects invalid service auth token', async () => {
    app = await buildApp('test-secret-123');

    const res = await app.inject({
      method: 'GET',
      url: '/api/service/ping',
      headers: { 'x-service-auth': 'Bearer wrong-secret' },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'Invalid service credential' });
  });

  it('skips registration when no secret is configured', async () => {
    app = await buildApp();

    const res = await app.inject({ method: 'GET', url: '/api/service/ping' });

    expect(res.statusCode).toBe(404);
  });
});
