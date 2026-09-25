import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerAuthPlugin } from './auth.js';

async function buildApp(apiKey?: string): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await registerAuthPlugin(app, { apiKey });

  app.get('/health', async () => ({ status: 'ok' }));
  app.get('/api/runs', async () => ({ ok: true }));
  app.post('/api/chat', async () => ({ ok: true }));
  app.get('/api/vault/status', async () => ({ ok: true }));
  app.get('/ws', async () => ({ ok: true }));
  app.get('/public', async () => ({ ok: true }));

  await app.ready();
  return app;
}

describe('registerAuthPlugin', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app?.close();
  });

  describe('when AUTOMATE_API_KEY is not set', () => {
    beforeEach(async () => {
      app = await buildApp();
    });

    it('allows all /api/* requests without auth', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/runs' });
      expect(res.statusCode).toBe(200);
    });

    it('allows /health without auth', async () => {
      const res = await app.inject({ method: 'GET', url: '/health' });
      expect(res.statusCode).toBe(200);
    });
  });

  describe('when AUTOMATE_API_KEY is set', () => {
    const API_KEY = 'test-secret-key-123';

    beforeEach(async () => {
      app = await buildApp(API_KEY);
    });

    it('allows /health without auth', async () => {
      const res = await app.inject({ method: 'GET', url: '/health' });
      expect(res.statusCode).toBe(200);
    });

    it('allows /ws without auth', async () => {
      const res = await app.inject({ method: 'GET', url: '/ws' });
      expect(res.statusCode).toBe(200);
    });

    it('allows non-/api/ routes without auth', async () => {
      const res = await app.inject({ method: 'GET', url: '/public' });
      expect(res.statusCode).toBe(200);
    });

    it('rejects /api/* without Authorization header', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/runs' });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({
        error: 'Unauthorized',
        message: 'Missing or invalid Authorization header',
      });
    });

    it('rejects /api/* with invalid Bearer token', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/runs',
        headers: { authorization: 'Bearer wrong-key' },
      });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({
        error: 'Unauthorized',
        message: 'Invalid API key',
      });
    });

    it('rejects /api/* with non-Bearer auth scheme', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/runs',
        headers: { authorization: 'Basic dXNlcjpwYXNz' },
      });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({
        error: 'Unauthorized',
        message: 'Missing or invalid Authorization header',
      });
    });

    it('allows /api/* with valid Bearer token', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/runs',
        headers: { authorization: `Bearer ${API_KEY}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true });
    });

    it('protects POST /api/chat with auth', async () => {
      const noAuth = await app.inject({ method: 'POST', url: '/api/chat' });
      expect(noAuth.statusCode).toBe(401);

      const withAuth = await app.inject({
        method: 'POST',
        url: '/api/chat',
        headers: { authorization: `Bearer ${API_KEY}` },
      });
      expect(withAuth.statusCode).toBe(200);
    });

    it('protects GET /api/vault/status with auth', async () => {
      const noAuth = await app.inject({ method: 'GET', url: '/api/vault/status' });
      expect(noAuth.statusCode).toBe(401);

      const withAuth = await app.inject({
        method: 'GET',
        url: '/api/vault/status',
        headers: { authorization: `Bearer ${API_KEY}` },
      });
      expect(withAuth.statusCode).toBe(200);
    });
  });
});
