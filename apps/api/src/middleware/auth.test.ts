import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createAuthMiddleware } from './auth.js';

function buildTestApp(apiKey: string | undefined, cookieSecret = 'cookie-secret-for-tests-123'): Hono {
  const app = new Hono();
  app.use('/*', createAuthMiddleware(apiKey, cookieSecret));
  app.get('/health', (c) => c.json({ status: 'healthy' }));
  app.get('/api/v1/health', (c) => c.json({ status: 'healthy' }));
  app.get('/api/v1/features', (c) => c.json({ features: {} }));
  app.post('/api/auth/login', (c) => c.json({ ok: true }));
  app.post('/api/auth/logout', (c) => c.json({ ok: true }));
  app.get('/api/auth/session', (c) => c.json({ authenticated: false }));
  app.get('/api/v1/reporter/events', (c) => c.json({ ok: true }));
  app.get('/api/v1/runs', (c) => c.json({ runs: [] }));
  app.get('/api/v1/dashboard/runs', (c) => c.json({ runs: [] }));
  return app;
}

describe('createAuthMiddleware', () => {
  const TEST_KEY = 'test-api-key-for-testing';

  describe('when no API key is configured (open mode)', () => {
    it('passes all requests through without auth', async () => {
      const app = buildTestApp(undefined);
      const res = await app.request('/api/v1/runs');
      expect(res.status).toBe(200);
    });
  });

  describe('when API key is configured', () => {
    let app: Hono;

    beforeEach(() => {
      app = buildTestApp(TEST_KEY);
    });

    it('returns 401 with { error: "Unauthorized" } when Authorization header is missing', async () => {
      const res = await app.request('/api/v1/runs');
      expect(res.status).toBe(401);
      const body = (await res.json()) as Record<string, string>;
      expect(body['error']).toBe('Unauthorized');
    });

    it('returns 401 when Bearer token is wrong', async () => {
      const res = await app.request('/api/v1/runs', {
        headers: { Authorization: 'Bearer wrong-key' },
      });
      expect(res.status).toBe(401);
      const body = (await res.json()) as Record<string, string>;
      expect(body['error']).toBe('Unauthorized');
    });

    it('returns 401 when Authorization scheme is not Bearer', async () => {
      const res = await app.request('/api/v1/runs', {
        headers: { Authorization: `Basic ${TEST_KEY}` },
      });
      expect(res.status).toBe(401);
    });

    it('passes through when Bearer token matches the configured key', async () => {
      const res = await app.request('/api/v1/runs', {
        headers: { Authorization: `Bearer ${TEST_KEY}` },
      });
      expect(res.status).toBe(200);
    });

    describe('public paths bypass auth', () => {
      it('GET /health is accessible without auth', async () => {
        const res = await app.request('/health');
        expect(res.status).toBe(200);
      });

      it('GET /api/v1/health is accessible without auth', async () => {
        const res = await app.request('/api/v1/health');
        expect(res.status).toBe(200);
      });

      it('GET /api/v1/features is accessible without auth', async () => {
        const res = await app.request('/api/v1/features');
        expect(res.status).toBe(200);
      });

      it('POST /api/auth/login is accessible without auth', async () => {
        const res = await app.request('/api/auth/login', { method: 'POST' });
        expect(res.status).toBe(200);
      });

      it('POST /api/auth/logout is accessible without auth', async () => {
        const res = await app.request('/api/auth/logout', { method: 'POST' });
        expect(res.status).toBe(200);
      });

      it('GET /api/auth/session is accessible without auth', async () => {
        const res = await app.request('/api/auth/session');
        expect(res.status).toBe(200);
      });

      it('GET /api/v1/reporter/* is accessible without auth (has its own auth)', async () => {
        const res = await app.request('/api/v1/reporter/events');
        expect(res.status).toBe(200);
      });
    });
  });
});
