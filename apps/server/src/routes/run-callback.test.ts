import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { runCallbackRoutes, runResults } from './run-callback.js';

vi.mock('../services/ai-triage.js', () => ({
  triageFailedRun: vi.fn().mockResolvedValue(undefined),
  triageResults: new Map(),
  getTriageForRun: vi.fn(),
}));

vi.mock('../services/feature-flags.js', () => ({
  isEnabled: vi.fn().mockReturnValue(false),
}));

import { triageFailedRun, triageResults } from '../services/ai-triage.js';
import { isEnabled } from '../services/feature-flags.js';

const SERVICE_SECRET = 'test-service-secret';
const AUTH_HEADER = `Bearer ${SERVICE_SECRET}`;

async function buildApp(serviceSecret?: string, dashboardApiUrl?: string): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(runCallbackRoutes, { serviceSecret, dashboardApiUrl });
  await app.ready();
  return app;
}

describe('runCallbackRoutes', () => {
  let app: FastifyInstance;

  beforeEach(() => {
    vi.clearAllMocks();
    runResults.clear();
    triageResults.clear();
    vi.mocked(isEnabled).mockReturnValue(false);
    vi.mocked(triageFailedRun).mockResolvedValue({
      runId: 'run-triage-test',
      analyzedAt: new Date().toISOString(),
      failures: [],
      summary: 'done',
    });
  });

  afterEach(async () => {
    await app?.close();
  });

  describe('POST /api/service/run-callback', () => {
    it('returns 200 { received: true } with valid payload', async () => {
      app = await buildApp(SERVICE_SECRET);

      const res = await app.inject({
        method: 'POST',
        url: '/api/service/run-callback',
        headers: {
          'x-service-auth': AUTH_HEADER,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          runId: 'run-abc123',
          status: 'passed',
          total: 10,
          passed: 10,
          failed: 0,
        }),
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ received: true });
    });

    it('stores the result in the runResults map', async () => {
      app = await buildApp(SERVICE_SECRET);

      await app.inject({
        method: 'POST',
        url: '/api/service/run-callback',
        headers: {
          'x-service-auth': AUTH_HEADER,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          runId: 'run-store-test',
          status: 'failed',
          total: 5,
          passed: 3,
          failed: 2,
          flaky: 1,
          skipped: 0,
          durationMs: 12345,
          dashboardUrl: 'http://localhost:4000/runs/run-store-test',
        }),
      });

      expect(runResults.has('run-store-test')).toBe(true);
      const stored = runResults.get('run-store-test');
      expect(stored?.status).toBe('failed');
      expect(stored?.total).toBe(5);
      expect(stored?.passed).toBe(3);
      expect(stored?.failed).toBe(2);
      expect(stored?.durationMs).toBe(12345);
    });

    it('returns 400 when runId is missing', async () => {
      app = await buildApp(SERVICE_SECRET);

      const res = await app.inject({
        method: 'POST',
        url: '/api/service/run-callback',
        headers: {
          'x-service-auth': AUTH_HEADER,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          status: 'passed',
          total: 5,
          passed: 5,
          failed: 0,
        }),
      });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: expect.stringContaining('runId') });
    });

    it('returns 400 when status is invalid', async () => {
      app = await buildApp(SERVICE_SECRET);

      const res = await app.inject({
        method: 'POST',
        url: '/api/service/run-callback',
        headers: {
          'x-service-auth': AUTH_HEADER,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          runId: 'run-bad-status',
          status: 'unknown',
          total: 5,
          passed: 5,
          failed: 0,
        }),
      });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: expect.stringContaining('status') });
    });

    it('returns 400 when total is missing', async () => {
      app = await buildApp(SERVICE_SECRET);

      const res = await app.inject({
        method: 'POST',
        url: '/api/service/run-callback',
        headers: {
          'x-service-auth': AUTH_HEADER,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          runId: 'run-no-total',
          status: 'passed',
          passed: 5,
          failed: 0,
        }),
      });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: expect.stringContaining('total') });
    });

    it('returns 400 when passed is missing', async () => {
      app = await buildApp(SERVICE_SECRET);

      const res = await app.inject({
        method: 'POST',
        url: '/api/service/run-callback',
        headers: {
          'x-service-auth': AUTH_HEADER,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          runId: 'run-no-passed',
          status: 'passed',
          total: 5,
          failed: 0,
        }),
      });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: expect.stringContaining('passed') });
    });

    it('returns 400 when failed is missing', async () => {
      app = await buildApp(SERVICE_SECRET);

      const res = await app.inject({
        method: 'POST',
        url: '/api/service/run-callback',
        headers: {
          'x-service-auth': AUTH_HEADER,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          runId: 'run-no-failed',
          status: 'passed',
          total: 5,
          passed: 5,
        }),
      });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: expect.stringContaining('failed') });
    });

    it('returns 401 when service auth header is missing', async () => {
      app = await buildApp(SERVICE_SECRET);

      const res = await app.inject({
        method: 'POST',
        url: '/api/service/run-callback',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          runId: 'run-no-auth',
          status: 'passed',
          total: 1,
          passed: 1,
          failed: 0,
        }),
      });

      expect(res.statusCode).toBe(401);
      expect(res.json()).toMatchObject({ error: expect.stringContaining('Missing') });
    });

    it('returns 403 when service auth token is wrong', async () => {
      app = await buildApp(SERVICE_SECRET);

      const res = await app.inject({
        method: 'POST',
        url: '/api/service/run-callback',
        headers: {
          'x-service-auth': 'Bearer wrong-secret',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          runId: 'run-wrong-auth',
          status: 'passed',
          total: 1,
          passed: 1,
          failed: 0,
        }),
      });

      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({ error: expect.stringContaining('Invalid') });
    });

    it('stores failedTests when provided', async () => {
      app = await buildApp(SERVICE_SECRET);

      await app.inject({
        method: 'POST',
        url: '/api/service/run-callback',
        headers: {
          'x-service-auth': AUTH_HEADER,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          runId: 'run-with-failures',
          status: 'failed',
          total: 3,
          passed: 2,
          failed: 1,
          failedTests: [
            { title: 'login test', file: 'auth.spec.ts', errorMessage: 'Expected true, got false' },
          ],
        }),
      });

      const stored = runResults.get('run-with-failures');
      expect(stored?.failedTests).toHaveLength(1);
      expect(stored?.failedTests?.[0]?.title).toBe('login test');
    });

    it('returns 404 when no serviceSecret is configured', async () => {
      app = await buildApp(undefined);

      const res = await app.inject({
        method: 'POST',
        url: '/api/service/run-callback',
        headers: {
          'x-service-auth': AUTH_HEADER,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ runId: 'run-x', status: 'passed', total: 1, passed: 1, failed: 0 }),
      });

      expect(res.statusCode).toBe(404);
    });
  });

  describe('GET /api/service/run-results/:runId', () => {
    it('returns 200 with stored result for existing runId', async () => {
      app = await buildApp(SERVICE_SECRET);

      const payload = {
        runId: 'run-get-test',
        status: 'passed' as const,
        total: 8,
        passed: 8,
        failed: 0,
        durationMs: 5000,
      };
      runResults.set(payload.runId, payload);

      const res = await app.inject({
        method: 'GET',
        url: '/api/service/run-results/run-get-test',
        headers: { 'x-service-auth': AUTH_HEADER },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        runId: 'run-get-test',
        status: 'passed',
        total: 8,
      });
    });

    it('returns 404 for non-existent runId', async () => {
      app = await buildApp(SERVICE_SECRET);

      const res = await app.inject({
        method: 'GET',
        url: '/api/service/run-results/nonexistent-run',
        headers: { 'x-service-auth': AUTH_HEADER },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: 'Run result not found' });
    });

    it('returns 401 when service auth header is missing on GET', async () => {
      app = await buildApp(SERVICE_SECRET);

      const res = await app.inject({
        method: 'GET',
        url: '/api/service/run-results/some-run',
      });

      expect(res.statusCode).toBe(401);
    });

    it('returns 403 when service auth token is wrong on GET', async () => {
      app = await buildApp(SERVICE_SECRET);

      const res = await app.inject({
        method: 'GET',
        url: '/api/service/run-results/some-run',
        headers: { 'x-service-auth': 'Bearer wrong' },
      });

      expect(res.statusCode).toBe(403);
    });
  });

  describe('POST /api/service/run-callback — triage integration', () => {
    it('triggers triage when ai-triage flag is enabled and run has failures', async () => {
      vi.mocked(isEnabled).mockReturnValue(true);
      app = await buildApp(SERVICE_SECRET);

      await app.inject({
        method: 'POST',
        url: '/api/service/run-callback',
        headers: { 'x-service-auth': AUTH_HEADER, 'content-type': 'application/json' },
        body: JSON.stringify({
          runId: 'run-triage-trigger',
          status: 'failed',
          total: 3,
          passed: 2,
          failed: 1,
          failedTests: [{ title: 'my failing test', file: 'test.spec.ts', errorMessage: 'boom' }],
        }),
      });

      // Give the fire-and-forget a tick to be called
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(triageFailedRun).toHaveBeenCalledOnce();
      expect(triageFailedRun).toHaveBeenCalledWith(
        expect.objectContaining({ runId: 'run-triage-trigger', failed: 1 }),
        expect.objectContaining({}),
      );
    });

    it('does not trigger triage when ai-triage flag is disabled', async () => {
      vi.mocked(isEnabled).mockReturnValue(false);
      app = await buildApp(SERVICE_SECRET);

      await app.inject({
        method: 'POST',
        url: '/api/service/run-callback',
        headers: { 'x-service-auth': AUTH_HEADER, 'content-type': 'application/json' },
        body: JSON.stringify({
          runId: 'run-no-triage',
          status: 'failed',
          total: 3,
          passed: 2,
          failed: 1,
          failedTests: [{ title: 'test', file: 'test.spec.ts', errorMessage: 'err' }],
        }),
      });

      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(triageFailedRun).not.toHaveBeenCalled();
    });

    it('does not trigger triage when ai-triage flag is enabled but no failures', async () => {
      vi.mocked(isEnabled).mockReturnValue(true);
      app = await buildApp(SERVICE_SECRET);

      await app.inject({
        method: 'POST',
        url: '/api/service/run-callback',
        headers: { 'x-service-auth': AUTH_HEADER, 'content-type': 'application/json' },
        body: JSON.stringify({
          runId: 'run-all-pass',
          status: 'passed',
          total: 3,
          passed: 3,
          failed: 0,
        }),
      });

      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(triageFailedRun).not.toHaveBeenCalled();
    });

    it('handles triage rejection gracefully (fire-and-forget catch)', async () => {
      vi.mocked(isEnabled).mockReturnValue(true);
      vi.mocked(triageFailedRun).mockRejectedValue(new Error('Ollama crashed'));
      app = await buildApp(SERVICE_SECRET);

      const res = await app.inject({
        method: 'POST',
        url: '/api/service/run-callback',
        headers: { 'x-service-auth': AUTH_HEADER, 'content-type': 'application/json' },
        body: JSON.stringify({
          runId: 'run-triage-crash',
          status: 'failed',
          total: 2,
          passed: 1,
          failed: 1,
          failedTests: [{ title: 'crash test', file: 'crash.spec.ts', errorMessage: 'boom' }],
        }),
      });

      // Callback returns 200 immediately — triage rejection is swallowed
      expect(res.statusCode).toBe(200);

      // Wait for the microtask queue to settle
      await new Promise((resolve) => setTimeout(resolve, 0));

      // triageFailedRun was called and rejected without crashing the server
      expect(triageFailedRun).toHaveBeenCalledOnce();
    });
  });

  describe('GET /api/service/run-triage/:runId', () => {
    it('returns 200 with triage result when triage is complete', async () => {
      app = await buildApp(SERVICE_SECRET);

      const triage = {
        runId: 'run-triage-done',
        analyzedAt: '2024-01-01T00:00:00.000Z',
        failures: [{ testTitle: 'my test', rootCause: 'oops', suggestedFix: 'fix it', confidence: 'high' as const }],
        summary: 'One failure analyzed.',
      };
      triageResults.set('run-triage-done', triage);

      const res = await app.inject({
        method: 'GET',
        url: '/api/service/run-triage/run-triage-done',
        headers: { 'x-service-auth': AUTH_HEADER },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        runId: 'run-triage-done',
        summary: 'One failure analyzed.',
        failures: expect.arrayContaining([
          expect.objectContaining({ testTitle: 'my test', confidence: 'high' }),
        ]),
      });
    });

    it('returns 404 when neither triage nor run result exists', async () => {
      app = await buildApp(SERVICE_SECRET);

      const res = await app.inject({
        method: 'GET',
        url: '/api/service/run-triage/run-not-found',
        headers: { 'x-service-auth': AUTH_HEADER },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: 'Triage result not found' });
    });

    it('returns 202 when run has failures but triage is not yet complete', async () => {
      app = await buildApp(SERVICE_SECRET);

      runResults.set('run-pending-triage', {
        runId: 'run-pending-triage',
        status: 'failed',
        total: 2,
        passed: 1,
        failed: 1,
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/service/run-triage/run-pending-triage',
        headers: { 'x-service-auth': AUTH_HEADER },
      });

      expect(res.statusCode).toBe(202);
      expect(res.json()).toEqual({ status: 'pending', message: 'Triage in progress' });
    });

    it('returns 401 when service auth header is missing', async () => {
      app = await buildApp(SERVICE_SECRET);

      const res = await app.inject({
        method: 'GET',
        url: '/api/service/run-triage/some-run',
      });

      expect(res.statusCode).toBe(401);
    });

    it('returns 403 when service auth token is wrong', async () => {
      app = await buildApp(SERVICE_SECRET);

      const res = await app.inject({
        method: 'GET',
        url: '/api/service/run-triage/some-run',
        headers: { 'x-service-auth': 'Bearer wrong' },
      });

      expect(res.statusCode).toBe(403);
    });
  });

  describe('POST /api/service/run-callback — Dashboard forwarding', () => {
    const DASHBOARD_URL = 'http://dashboard.test:4000';
    const mockFetch = vi.fn();

    beforeEach(() => {
      globalThis.fetch = mockFetch;
      mockFetch.mockReset();
      mockFetch.mockResolvedValue(new Response('{"received":true}', { status: 202 }));
    });

    afterEach(() => {
      // Restore: other tests do not rely on globalThis.fetch
      globalThis.fetch = undefined as unknown as typeof fetch;
    });

    it('forwards result to Dashboard when DASHBOARD_API_URL and serviceSecret are set', async () => {
      app = await buildApp(SERVICE_SECRET, DASHBOARD_URL);

      await app.inject({
        method: 'POST',
        url: '/api/service/run-callback',
        headers: { 'x-service-auth': AUTH_HEADER, 'content-type': 'application/json' },
        body: JSON.stringify({
          runId: 'run-forward-test',
          status: 'failed',
          total: 3,
          passed: 2,
          failed: 1,
          prNumber: 42,
          prBranch: 'copilot/fix-login',
          commitAuthor: 'copilot[bot]',
          failedTests: [{ title: 'login test', file: 'auth.spec.ts', errorMessage: 'boom' }],
        }),
      });

      // Give the fire-and-forget a tick
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(mockFetch).toHaveBeenCalledOnce();

      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${DASHBOARD_URL}/api/run-callback`);
      expect((init.headers as Record<string, string>)['x-service-secret']).toBe(SERVICE_SECRET);
      expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
      expect(init.method).toBe('POST');

      const sentBody = JSON.parse(init.body as string) as Record<string, unknown>;
      expect(sentBody.runId).toBe('run-forward-test');
      expect(sentBody.status).toBe('failed');
      expect(sentBody.totalTests).toBe(3);
      expect(sentBody.passedTests).toBe(2);
      expect(sentBody.failedTests).toBe(1);
      expect(sentBody.prNumber).toBe(42);
      expect(sentBody.prBranch).toBe('copilot/fix-login');
      expect(sentBody.commitAuthor).toBe('copilot[bot]');
      expect(Array.isArray(sentBody.failedTestDetails)).toBe(true);
    });

    it('still returns 200 even when Dashboard forwarding fails', async () => {
      mockFetch.mockRejectedValue(new Error('Dashboard is down'));
      app = await buildApp(SERVICE_SECRET, DASHBOARD_URL);

      const res = await app.inject({
        method: 'POST',
        url: '/api/service/run-callback',
        headers: { 'x-service-auth': AUTH_HEADER, 'content-type': 'application/json' },
        body: JSON.stringify({
          runId: 'run-forward-crash',
          status: 'passed',
          total: 1,
          passed: 1,
          failed: 0,
        }),
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ received: true });

      // Wait for the rejection to be handled
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    it('does not call fetch when dashboardApiUrl is absent', async () => {
      app = await buildApp(SERVICE_SECRET); // no dashboardApiUrl

      await app.inject({
        method: 'POST',
        url: '/api/service/run-callback',
        headers: { 'x-service-auth': AUTH_HEADER, 'content-type': 'application/json' },
        body: JSON.stringify({
          runId: 'run-no-forward',
          status: 'passed',
          total: 1,
          passed: 1,
          failed: 0,
        }),
      });

      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('still stores result locally when forwarding is enabled', async () => {
      app = await buildApp(SERVICE_SECRET, DASHBOARD_URL);

      await app.inject({
        method: 'POST',
        url: '/api/service/run-callback',
        headers: { 'x-service-auth': AUTH_HEADER, 'content-type': 'application/json' },
        body: JSON.stringify({
          runId: 'run-forward-store',
          status: 'passed',
          total: 5,
          passed: 5,
          failed: 0,
        }),
      });

      expect(runResults.has('run-forward-store')).toBe(true);
    });

    it('does not include serviceSecret value in forwarded payload body', async () => {
      app = await buildApp(SERVICE_SECRET, DASHBOARD_URL);

      await app.inject({
        method: 'POST',
        url: '/api/service/run-callback',
        headers: { 'x-service-auth': AUTH_HEADER, 'content-type': 'application/json' },
        body: JSON.stringify({
          runId: 'run-secret-check',
          status: 'passed',
          total: 1,
          passed: 1,
          failed: 0,
        }),
      });

      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(mockFetch).toHaveBeenCalledOnce();
      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      const bodyStr = init.body as string;
      expect(bodyStr).not.toContain(SERVICE_SECRET);
    });
  });
});
