import Fastify from 'fastify';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { healthUnifiedRoutes } from './health-unified.js';

describe('healthUnifiedRoutes', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NODE_ENV = 'test';
    process.env.FEATURE_UNIFIED_HEALTH = 'true';
    vi.restoreAllMocks();
  });

  it('returns healthy when dashboard responds ok', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/health')) {
        return new Response(JSON.stringify({ status: 'ok', db: 'connected', reporter: 'connected' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response('ok', { status: 200 });
    });

    const app = Fastify();
    await app.register(healthUnifiedRoutes, { dashboardUrl: 'http://dashboard.local' });
    await app.ready();

    const response = await app.inject({ method: 'GET', url: '/api/health/unified' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(expect.objectContaining({
      unified: 'healthy',
      automate: expect.objectContaining({ status: 'ok', db: 'connected' }),
      dashboard: expect.objectContaining({ status: 'ok', db: 'connected', reporter: 'connected' }),
    }));

    await app.close();
  });

  it('returns degraded when dashboard is unreachable', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/health')) {
        throw new Error('unreachable');
      }

      return new Response('ok', { status: 200 });
    });

    const app = Fastify();
    await app.register(healthUnifiedRoutes, { dashboardUrl: 'http://dashboard.local' });
    await app.ready();

    const response = await app.inject({ method: 'GET', url: '/api/health/unified' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      unified: 'degraded',
      dashboard: { status: 'unreachable' },
    });

    await app.close();
  });

  it('responds within 6s even if dashboard check times out', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/health')) {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        });
      }

      return new Response('ok', { status: 200 });
    });

    const app = Fastify();
    await app.register(healthUnifiedRoutes, { dashboardUrl: 'http://dashboard.local' });
    await app.ready();

    const started = Date.now();
    const response = await app.inject({ method: 'GET', url: '/api/health/unified' });
    const elapsed = Date.now() - started;

    expect(response.statusCode).toBe(200);
    expect(elapsed).toBeLessThan(6000);

    await app.close();
  }, 7000);

  it('returns 404 when feature flag is disabled outside test bypass', async () => {
    process.env.NODE_ENV = 'production';
    process.env.FEATURE_UNIFIED_HEALTH = 'false';

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok', { status: 200 }));

    const app = Fastify();
    await app.register(healthUnifiedRoutes, { dashboardUrl: 'http://dashboard.local' });
    await app.ready();

    const response = await app.inject({ method: 'GET', url: '/api/health/unified' });

    expect(response.statusCode).toBe(404);

    await app.close();
  });

  it('returns degraded when dashboard returns non-200 status', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/health')) {
        return new Response('Service Unavailable', { status: 503 });
      }

      return new Response('ok', { status: 200 });
    });

    const app = Fastify();
    await app.register(healthUnifiedRoutes, { dashboardUrl: 'http://dashboard.local' });
    await app.ready();

    const response = await app.inject({ method: 'GET', url: '/api/health/unified' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      unified: 'degraded',
      dashboard: { status: 'error' },
    });

    await app.close();
  });

  it('reports ollama as disconnected when ollama fetch throws', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/tags')) {
        throw new Error('ollama unreachable');
      }
      if (url.includes('/health')) {
        return new Response(JSON.stringify({ status: 'ok', db: 'connected', reporter: 'connected' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response('ok', { status: 200 });
    });

    const app = Fastify();
    await app.register(healthUnifiedRoutes, { dashboardUrl: 'http://dashboard.local' });
    await app.ready();

    const response = await app.inject({ method: 'GET', url: '/api/health/unified' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      unified: 'healthy',
      automate: { ollama: 'disconnected' },
    });

    await app.close();
  });

  it('reports ollama as error when ollama returns non-200', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/tags')) {
        return new Response('Not Found', { status: 404 });
      }
      if (url.includes('/health')) {
        return new Response(JSON.stringify({ status: 'ok', db: 'connected', reporter: 'connected' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response('ok', { status: 200 });
    });

    const app = Fastify();
    await app.register(healthUnifiedRoutes, { dashboardUrl: 'http://dashboard.local' });
    await app.ready();

    const response = await app.inject({ method: 'GET', url: '/api/health/unified' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      unified: 'healthy',
      automate: { ollama: 'error' },
    });

    await app.close();
  });

  afterAll(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });
});
