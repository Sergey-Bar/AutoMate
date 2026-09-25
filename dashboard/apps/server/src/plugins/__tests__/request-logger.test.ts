import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import { registerRequestLogger } from '../request-logger.js';

describe('request-logger plugin', () => {
  it('logs request completion with method, url, statusCode, and responseTime', async () => {
    const app = Fastify({ logger: false });
    const logSpy = vi.fn();
    app.log.info = logSpy;

    await registerRequestLogger(app);
    app.get('/test', async () => ({ ok: true }));

    const res = await app.inject({ method: 'GET', url: '/test' });
    expect(res.statusCode).toBe(200);

    const logCall = logSpy.mock.calls.find(
      (c) => typeof c[0] === 'object' && c[0]?.method === 'GET',
    );
    expect(logCall).toBeDefined();
    expect(logCall![0]).toMatchObject({
      method: 'GET',
      url: '/test',
      statusCode: 200,
    });
    expect(logCall![0]).toHaveProperty('responseTime');
  });

  it('skips health endpoints to reduce log noise', async () => {
    const app = Fastify({ logger: false });
    const logSpy = vi.fn();
    app.log.info = logSpy;

    await registerRequestLogger(app);
    app.get('/health/live', async () => ({ status: 'ok' }));

    await app.inject({ method: 'GET', url: '/health/live' });

    const logCall = logSpy.mock.calls.find(
      (c) => typeof c[0] === 'object' && c[0]?.url === '/health/live',
    );
    expect(logCall).toBeUndefined();
  });
});
