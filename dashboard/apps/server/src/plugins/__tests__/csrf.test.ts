/// <reference types="vitest" />
import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { isCsrfSafe, registerCsrfPlugin } from '../csrf.js';

describe('isCsrfSafe()', () => {
  const base = {
    method: 'POST',
    url: '/api/runs',
    origin: undefined,
    xRequestedWith: undefined,
    authorization: undefined,
    xServiceAuth: undefined,
  };

  // ── Safe by method ─────────────────────────────────────────────────────────

  it('allows GET requests without any headers', () => {
    expect(isCsrfSafe({ ...base, method: 'GET' })).toBe(true);
  });

  it('allows HEAD requests', () => {
    expect(isCsrfSafe({ ...base, method: 'HEAD' })).toBe(true);
  });

  it('allows OPTIONS requests', () => {
    expect(isCsrfSafe({ ...base, method: 'OPTIONS' })).toBe(true);
  });

  // ── Safe by auth type ──────────────────────────────────────────────────────

  it('allows mutation with Authorization header (Bearer/API key)', () => {
    expect(isCsrfSafe({ ...base, authorization: 'Bearer abc123' })).toBe(true);
  });

  it('allows mutation with X-Service-Auth header', () => {
    expect(isCsrfSafe({ ...base, xServiceAuth: 'Bearer service-secret' })).toBe(true);
  });

  // ── Safe by custom header ──────────────────────────────────────────────────

  it('allows mutation with X-Requested-With header', () => {
    expect(isCsrfSafe({ ...base, xRequestedWith: 'XMLHttpRequest' })).toBe(true);
  });

  // ── Safe by matching Origin ────────────────────────────────────────────────

  it('allows mutation when Origin matches CORS_ORIGIN', () => {
    // Default CORS_ORIGIN in test is undefined → falls back to http://localhost:5173
    expect(isCsrfSafe({ ...base, origin: 'http://localhost:5173' })).toBe(true);
  });

  // ── Exempt paths ───────────────────────────────────────────────────────────

  it('allows POST /api/auth/saml/callback without CSRF headers', () => {
    expect(isCsrfSafe({ ...base, url: '/api/auth/saml/callback' })).toBe(true);
  });

  it('allows POST /api/auth/login without CSRF headers', () => {
    expect(isCsrfSafe({ ...base, url: '/api/auth/login' })).toBe(true);
  });

  it('allows POST /api/auth/bootstrap without CSRF headers', () => {
    expect(isCsrfSafe({ ...base, url: '/api/auth/bootstrap' })).toBe(true);
  });

  // ── Rejection cases ────────────────────────────────────────────────────────

  it('rejects mutation without any safe indicators', () => {
    expect(isCsrfSafe(base)).toBe(false);
  });

  it('rejects mutation with non-matching Origin', () => {
    expect(isCsrfSafe({ ...base, origin: 'https://evil.com' })).toBe(false);
  });

  it('rejects DELETE without safe indicators', () => {
    expect(isCsrfSafe({ ...base, method: 'DELETE' })).toBe(false);
  });

  it('rejects PUT without safe indicators', () => {
    expect(isCsrfSafe({ ...base, method: 'PUT' })).toBe(false);
  });

  it('rejects PATCH without safe indicators', () => {
    expect(isCsrfSafe({ ...base, method: 'PATCH' })).toBe(false);
  });
});

// ── registerCsrfPlugin integration ──────────────────────────────────────────

describe('registerCsrfPlugin()', () => {
  it('rejects unsafe mutations with 403 when registered on a Fastify app', async () => {
    const app = Fastify();
    await registerCsrfPlugin(app);
    app.post('/test', async () => ({ ok: true }));
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/test',
      // No Origin, X-Requested-With, Authorization — should be blocked
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'CSRF validation failed' });
    await app.close();
  });

  it('allows safe requests through when registered on a Fastify app', async () => {
    const app = Fastify();
    await registerCsrfPlugin(app);
    app.post('/test', async () => ({ ok: true }));
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/test',
      headers: { 'x-requested-with': 'XMLHttpRequest' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    await app.close();
  });
});
