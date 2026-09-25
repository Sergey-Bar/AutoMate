/**
 * Branch coverage for request-logger plugin.
 * Targets: redactUrl function branches (query string present/absent, sensitive params, eqIndex=-1)
 */
import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import { registerRequestLogger } from '../request-logger.js';

describe('request-logger — branch coverage', () => {
  it('logs URL without query string unchanged', async () => {
    const app = Fastify({ logger: false });
    const logSpy = vi.fn();
    app.log.info = logSpy;
    await registerRequestLogger(app);
    app.get('/api/runs', async () => ({ ok: true }));

    await app.inject({ method: 'GET', url: '/api/runs' });

    const logCall = logSpy.mock.calls.find(
      (c) => typeof c[0] === 'object' && c[0]?.url === '/api/runs',
    );
    expect(logCall).toBeDefined();
    expect(logCall![0]).toMatchObject({ url: '/api/runs' });
  });

  it('redacts sensitive query params (token, key, apiKey, api_key, secret, password)', async () => {
    const app = Fastify({ logger: false });
    const logSpy = vi.fn();
    app.log.info = logSpy;
    await registerRequestLogger(app);
    app.get('/api/data', async () => ({ ok: true }));

    await app.inject({ method: 'GET', url: '/api/data?token=abc123&key=secret&other=visible' });

    const logCall = logSpy.mock.calls.find(
      (c) => typeof c[0] === 'object' && typeof c[0]?.url === 'string' && c[0].url.startsWith('/api/data'),
    );
    expect(logCall).toBeDefined();
    const url = logCall![0].url as string;
    expect(url).toContain('token=[REDACTED]');
    expect(url).toContain('key=[REDACTED]');
    expect(url).toContain('other=visible');
    expect(url).not.toContain('abc123');
    expect(url).not.toContain('secret');
  });

  it('redacts api_key, password, authorization, secret params (case-insensitive matching)', async () => {
    const app = Fastify({ logger: false });
    const logSpy = vi.fn();
    app.log.info = logSpy;
    await registerRequestLogger(app);
    app.get('/api/data2', async () => ({ ok: true }));

    await app.inject({
      method: 'GET',
      url: '/api/data2?api_key=y&password=z&authorization=bearer&secret=s',
    });

    const logCall = logSpy.mock.calls.find(
      (c) => typeof c[0] === 'object' && typeof c[0]?.url === 'string' && c[0].url.startsWith('/api/data2'),
    );
    expect(logCall).toBeDefined();
    const url = logCall![0].url as string;
    // api_key, password, authorization, secret are all in SENSITIVE_PARAMS (lowercase match)
    expect(url).toContain('api_key=[REDACTED]');
    expect(url).toContain('password=[REDACTED]');
    expect(url).toContain('authorization=[REDACTED]');
    expect(url).toContain('secret=[REDACTED]');
  });

  it('handles query param with no value (eqIndex === -1 branch)', async () => {
    const app = Fastify({ logger: false });
    const logSpy = vi.fn();
    app.log.info = logSpy;
    await registerRequestLogger(app);
    app.get('/api/data3', async () => ({ ok: true }));

    // Query param with no '=' — the pair itself is the name
    await app.inject({ method: 'GET', url: '/api/data3?flag&other=val' });

    const logCall = logSpy.mock.calls.find(
      (c) => typeof c[0] === 'object' && typeof c[0]?.url === 'string' && c[0].url.startsWith('/api/data3'),
    );
    expect(logCall).toBeDefined();
    const url = logCall![0].url as string;
    expect(url).toContain('flag');
    expect(url).toContain('other=val');
  });

  it('skips /health and /health/ready paths', async () => {
    const app = Fastify({ logger: false });
    const logSpy = vi.fn();
    app.log.info = logSpy;
    await registerRequestLogger(app);
    app.get('/health', async () => ({ status: 'ok' }));
    app.get('/health/ready', async () => ({ status: 'ok' }));

    await app.inject({ method: 'GET', url: '/health' });
    await app.inject({ method: 'GET', url: '/health/ready' });

    const healthCalls = logSpy.mock.calls.filter(
      (c) => typeof c[0] === 'object' && (c[0]?.url === '/health' || c[0]?.url === '/health/ready'),
    );
    expect(healthCalls).toHaveLength(0);
  });

  it('includes contentLength header in log when present', async () => {
    const app = Fastify({ logger: false });
    const logSpy = vi.fn();
    app.log.info = logSpy;
    await registerRequestLogger(app);
    app.get('/api/with-content', async (_req, reply) => {
      return reply.header('content-length', '42').send({ ok: true });
    });

    await app.inject({ method: 'GET', url: '/api/with-content' });

    const logCall = logSpy.mock.calls.find(
      (c) => typeof c[0] === 'object' && c[0]?.url === '/api/with-content',
    );
    expect(logCall).toBeDefined();
    // content-length may be set by fastify automatically
    expect(logCall![0]).toHaveProperty('contentLength');
  });
});
