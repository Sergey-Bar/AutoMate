import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import { createAuthMiddleware } from './auth.js';

function buildTestApp(apiKey: string | undefined): Hono {
  const app = new Hono();
  app.use('/*', createAuthMiddleware(apiKey));
  app.get('/health', (c) => c.json({ status: 'healthy' }));
  app.get('/api/v1/health', (c) => c.json({ status: 'healthy' }));
  app.get('/api/v1/features', (c) => c.json({ features: {} }));
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

    it('keeps canonical runner and job paths public', async () => {
      const app = new Hono();
      app.use('/*', createAuthMiddleware(undefined));
      app.get('/api/v1/runners/register', (c) => c.json({ ok: true }));
      app.get('/api/v1/jobs/1/events', (c) => c.json({ ok: true }));
      expect((await app.request('/api/v1/runners/register')).status).toBe(200);
      expect((await app.request('/api/v1/jobs/1/events')).status).toBe(200);
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

    it('accepts a validated session cookie before checking the API key', async () => {
      const sessionApp = new Hono();
      sessionApp.use(
        '/*',
        createAuthMiddleware(TEST_KEY, async () => ({ userId: 'user-1' })),
      );
      sessionApp.get('/api/v1/runs', (c) => c.json({ ok: true }));
      const response = await sessionApp.request('/api/v1/runs', {
        headers: { Cookie: 'automate_session=signed-session' },
      });
      expect(response.status).toBe(200);
    });

    it('returns configuration failure for production open mode', async () => {
      const previous = process.env['NODE_ENV'];
      process.env['NODE_ENV'] = 'production';
      try {
        const openApp = new Hono();
        openApp.use('/*', createAuthMiddleware(undefined));
        openApp.get('/api/v1/runs', (c) => c.json({}));
        expect((await openApp.request('/api/v1/runs')).status).toBe(503);
      } finally {
        if (previous === undefined) delete process.env['NODE_ENV'];
        else process.env['NODE_ENV'] = previous;
      }
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

      it('GET /api/v1/reporter/* is accessible without auth (has its own auth)', async () => {
        const res = await app.request('/api/v1/reporter/events');
        expect(res.status).toBe(200);
      });
    });

    describe('runner-token bypass is an exact allowlist', () => {
      const runnerApp = (): Hono => {
        const runner = new Hono();
        runner.use('/*', createAuthMiddleware(TEST_KEY));
        runner.get('/api/v1/runners/register', (c) => c.json({ ok: true }));
        runner.get('/api/v1/runners/:runnerId/heartbeat', (c) => c.json({ ok: true }));
        runner.get('/api/v1/runners/:runnerId/jobs/claim', (c) => c.json({ ok: true }));
        runner.get('/api/v1/jobs/:jobId/events', (c) => c.json({ ok: true }));
        runner.get('/api/v1/jobs/:jobId/artifacts', (c) => c.json({ ok: true }));
        runner.get('/api/v1/jobs/:jobId/complete', (c) => c.json({ ok: true }));
        return runner;
      };

      it('lets the declared runner routes through the API-key check', async () => {
        const runner = runnerApp();
        for (const path of [
          '/api/v1/runners/register',
          '/api/v1/runners/runner-1/heartbeat',
          '/api/v1/runners/runner-1/jobs/claim',
          '/api/v1/jobs/job-1/events',
          '/api/v1/jobs/job-1/artifacts',
          '/api/v1/jobs/job-1/complete',
        ]) {
          expect((await runner.request(path)).status).toBe(200);
        }
      });

      it('does not let an undeclared route under those prefixes through', async () => {
        // These used to bypass authentication purely because of a startsWith.
        for (const path of [
          '/api/v1/jobs',
          '/api/v1/jobs/job-1/cancel',
          '/api/v1/jobs/job-1/anything-new',
          '/api/v1/runners',
          '/api/v1/runners/runner-1/secrets',
          '/api/v1/runner/v1/anything-new',
        ]) {
          const response = await app.request(path);
          expect(response.status).toBe(401);
        }
      });

      it('does not let a deeper path impersonate a declared one', async () => {
        const response = await app.request('/api/v1/jobs/job-1/events/extra');
        expect(response.status).toBe(401);
      });
    });

    describe('session validation failures', () => {
      it('falls through to the API key instead of 500-ing when the store is down', async () => {
        const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
        try {
          const flaky = new Hono();
          flaky.use(
            '/*',
            createAuthMiddleware(TEST_KEY, () => {
              throw new Error('connection terminated unexpectedly');
            }),
          );
          flaky.get('/api/v1/runs', (c) => c.json({ runs: [] }));
          const response = await flaky.request('/api/v1/runs', {
            headers: { Cookie: 'automate_session=signed-session' },
          });
          expect(response.status).toBe(401);
          expect(errorLog).toHaveBeenCalled();

          const withKey = await flaky.request('/api/v1/runs', {
            headers: {
              Cookie: 'automate_session=signed-session',
              Authorization: `Bearer ${TEST_KEY}`,
            },
          });
          expect(withKey.status).toBe(200);
        } finally {
          errorLog.mockRestore();
        }
      });
    });
  });
});
