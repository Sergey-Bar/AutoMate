import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { registerSecurityHeaders } from './security-headers.js';

describe('registerSecurityHeaders', () => {
  it('sets Content-Security-Policy header on responses', async () => {
    const app = Fastify();
    await registerSecurityHeaders(app);
    app.get('/test', async () => ({ ok: true }));
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/test' });

    expect(res.statusCode).toBe(200);
    const csp = res.headers['content-security-policy'];
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'self'");
  });

  it('sets X-Content-Type-Options header', async () => {
    const app = Fastify();
    await registerSecurityHeaders(app);
    app.get('/test', async () => ({ ok: true }));
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/test' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('sets X-Frame-Options header', async () => {
    const app = Fastify();
    await registerSecurityHeaders(app);
    app.get('/test', async () => ({ ok: true }));
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/test' });
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
  });

  it('sets Referrer-Policy header', async () => {
    const app = Fastify();
    await registerSecurityHeaders(app);
    app.get('/test', async () => ({ ok: true }));
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/test' });
    expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
  });

  it('sets Permissions-Policy header', async () => {
    const app = Fastify();
    await registerSecurityHeaders(app);
    app.get('/test', async () => ({ ok: true }));
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/test' });
    expect(res.headers['permissions-policy']).toBe('camera=(), microphone=(), geolocation=()');
  });
});
