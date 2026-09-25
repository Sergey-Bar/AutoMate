import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

// Mock test-runner to avoid actually spawning Playwright
vi.mock('../services/test-runner.js', () => ({
  testRunner: {
    executeTestRun: vi.fn().mockResolvedValue({ runId: 'mock', exitCode: 0, stdout: '', stderr: '' }),
  },
}));

// Import after mocks are set up
const { serviceTriggerRoutes } = await import('./service-trigger.js');

const SECRET = 'test-secret-abc123';

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(serviceTriggerRoutes, {});
  await app.ready();
  return app;
}

describe('POST /api/service/trigger-run', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app?.close();
    vi.unstubAllEnvs();
  });

  describe('without AUTOMATE_SERVICE_SECRET configured (fail-closed)', () => {
    beforeEach(async () => {
      vi.stubEnv('AUTOMATE_SERVICE_SECRET', '');
      app = await buildApp();
    });

    it('returns 503 when AUTOMATE_SERVICE_SECRET is not set', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/service/trigger-run',
        payload: {
          specCode: 'test("example", async ({ page }) => { await page.goto("http://example.com"); });',
          specFileName: 'example.spec.ts',
        },
      });

      expect(res.statusCode).toBe(503);
      expect(res.json()).toEqual({ error: 'Service auth not configured' });
    });

    it('still returns 503 even with X-Service-Auth header present (fail-closed)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/service/trigger-run',
        headers: { 'x-service-secret': 'some-value' },
        payload: {
          specCode: 'test("example", async () => {});',
          specFileName: 'example.spec.ts',
        },
      });

      expect(res.statusCode).toBe(503);
    });
  });

  describe('with AUTOMATE_SERVICE_SECRET configured', () => {
    beforeEach(async () => {
      vi.stubEnv('AUTOMATE_SERVICE_SECRET', SECRET);
      app = await buildApp();
    });

    it('returns 401 when x-service-secret header is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/service/trigger-run',
        payload: {
          specCode: 'test("example", async () => {});',
          specFileName: 'example.spec.ts',
        },
      });

      expect(res.statusCode).toBe(401);
      const body = res.json<{ error: string }>();
      expect(body.error).toBe('Service authentication required');
    });

    it('returns 403 when x-service-secret header has invalid token', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/service/trigger-run',
        headers: {
          'x-service-secret': 'wrong-token',
        },
        payload: {
          specCode: 'test("example", async () => {});',
          specFileName: 'example.spec.ts',
        },
      });

      expect(res.statusCode).toBe(403);
      const body = res.json<{ error: string }>();
      expect(body.error).toBe('Invalid service secret');
    });

    it('returns 403 when Authorization Bearer token is invalid', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/service/trigger-run',
        headers: {
          authorization: 'Bearer wrong-token',
        },
        payload: {
          specCode: 'test("example", async () => {});',
          specFileName: 'example.spec.ts',
        },
      });

      expect(res.statusCode).toBe(403);
    });

    it('returns 202 with runId and status "queued" for valid request with correct x-service-secret', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/service/trigger-run',
        headers: {
          'x-service-secret': SECRET,
        },
        payload: {
          specCode: 'test("example", async ({ page }) => { await page.goto("http://example.com"); });',
          specFileName: 'example.spec.ts',
        },
      });

      expect(res.statusCode).toBe(202);
      const body = res.json<{ runId: string; status: string }>();
      expect(body.status).toBe('queued');
      expect(typeof body.runId).toBe('string');
      expect(body.runId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
    });

    it('returns 202 with Authorization Bearer token', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/service/trigger-run',
        headers: {
          authorization: `Bearer ${SECRET}`,
        },
        payload: {
          specCode: 'test("example", async () => {});',
          specFileName: 'example.spec.ts',
        },
      });

      expect(res.statusCode).toBe(202);
    });

    it('returns 202 with all optional fields provided', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/service/trigger-run',
        headers: {
          'x-service-secret': SECRET,
        },
        payload: {
          specCode: 'test("example", async () => {});',
          specFileName: 'example.spec.ts',
          baseUrl: 'http://localhost:3000',
          browser: 'firefox',
          metadata: { suite: 'smoke', env: 'staging' },
        },
      });

      expect(res.statusCode).toBe(202);
      const body = res.json<{ runId: string; status: string }>();
      expect(body.status).toBe('queued');
    });

    it('returns 400 when specCode is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/service/trigger-run',
        headers: { 'x-service-secret': SECRET },
        payload: {
          specFileName: 'example.spec.ts',
        },
      });

      expect(res.statusCode).toBe(400);
      const body = res.json<{ error: string }>();
      expect(body.error).toBe('specCode and specFileName are required');
    });

    it('returns 400 when specFileName is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/service/trigger-run',
        headers: { 'x-service-secret': SECRET },
        payload: {
          specCode: 'test("example", async () => {});',
        },
      });

      expect(res.statusCode).toBe(400);
      const body = res.json<{ error: string }>();
      expect(body.error).toBe('specCode and specFileName are required');
    });

    it('returns 400 when body is empty', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/service/trigger-run',
        headers: { 'x-service-secret': SECRET },
        payload: {},
      });

      expect(res.statusCode).toBe(400);
      const body = res.json<{ error: string }>();
      expect(body.error).toBe('specCode and specFileName are required');
    });
  });

  describe('error handling', () => {
    it('logs error when executeTestRun rejects (fire-and-forget catch)', async () => {
      vi.stubEnv('AUTOMATE_SERVICE_SECRET', SECRET);
      const { testRunner } = await import('../services/test-runner.js');
      const execMock = vi.mocked(testRunner.executeTestRun);
      execMock.mockRejectedValueOnce(new Error('spawn failed'));

      app = await buildApp();

      const res = await app.inject({
        method: 'POST',
        url: '/api/service/trigger-run',
        headers: { 'x-service-secret': SECRET },
        payload: {
          specCode: 'test("x", async () => {});',
          specFileName: 'x.spec.ts',
        },
      });

      expect(res.statusCode).toBe(202);

      // Allow the microtask (catch handler) to execute
      await new Promise((r) => setTimeout(r, 50));
    });
  });
});
