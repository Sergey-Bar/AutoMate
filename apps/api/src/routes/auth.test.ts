import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { app } from '../index.js';

const ENV_API_KEY = 'AUTOMATE_API_KEY';
const ENV_COOKIE_SECRET = 'COOKIE_SECRET';

describe('auth routes', () => {
  const originalApiKey = process.env[ENV_API_KEY];
  const originalCookieSecret = process.env[ENV_COOKIE_SECRET];

  beforeEach(() => {
    delete process.env[ENV_API_KEY];
    delete process.env[ENV_COOKIE_SECRET];
  });

  afterEach(() => {
    if (originalApiKey === undefined) {
      delete process.env[ENV_API_KEY];
    } else {
      process.env[ENV_API_KEY] = originalApiKey;
    }

    if (originalCookieSecret === undefined) {
      delete process.env[ENV_COOKIE_SECRET];
    } else {
      process.env[ENV_COOKIE_SECRET] = originalCookieSecret;
    }
  });

  it('reports authenticated=true in open mode', async () => {
    const res = await app.request('/api/auth/session');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { authenticated?: boolean; authMode?: string };
    expect(body.authenticated).toBe(true);
    expect(body.authMode).toBe('open');
  });

  it('creates signed session cookie on valid login and grants access to protected routes', async () => {
    process.env[ENV_API_KEY] = 'test-api-key-123456';
    process.env[ENV_COOKIE_SECRET] = 'cookie-secret-that-is-long-enough-123';

    const loginRes = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: 'test-api-key-123456' }),
    });

    expect(loginRes.status).toBe(200);
    const setCookieHeader = loginRes.headers.get('set-cookie');
    expect(setCookieHeader).toBeTruthy();

    const sessionRes = await app.request('/api/auth/session', {
      headers: { Cookie: setCookieHeader ?? '' },
    });
    expect(sessionRes.status).toBe(200);
    const sessionBody = (await sessionRes.json()) as { authenticated: boolean };
    expect(sessionBody.authenticated).toBe(true);

    const protectedRes = await app.request('/api/v1/runs', {
      headers: { Cookie: setCookieHeader ?? '' },
    });
    expect(protectedRes.status).toBe(200);
  });

  it('rejects invalid API key login with 401', async () => {
    process.env[ENV_API_KEY] = 'test-api-key-123456';
    process.env[ENV_COOKIE_SECRET] = 'cookie-secret-that-is-long-enough-123';

    const loginRes = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: 'wrong-key' }),
    });

    expect(loginRes.status).toBe(401);
  });

  it('rejects malformed login payload with 400', async () => {
    process.env[ENV_API_KEY] = 'test-api-key-123456';
    process.env[ENV_COOKIE_SECRET] = 'cookie-secret-that-is-long-enough-123';

    const loginRes = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(loginRes.status).toBe(400);
  });

  it('returns 500 when login succeeds but cookie secret is missing', async () => {
    process.env[ENV_API_KEY] = 'test-api-key-123456';

    const loginRes = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: 'test-api-key-123456' }),
    });

    expect(loginRes.status).toBe(500);
  });

  it('reports authenticated=false when API key mode is enabled but no valid cookie is present', async () => {
    process.env[ENV_API_KEY] = 'test-api-key-123456';
    process.env[ENV_COOKIE_SECRET] = 'cookie-secret-that-is-long-enough-123';

    const sessionRes = await app.request('/api/auth/session');
    expect(sessionRes.status).toBe(200);
    const sessionBody = (await sessionRes.json()) as { authenticated: boolean };
    expect(sessionBody.authenticated).toBe(false);
  });

  it('logout clears session cookie', async () => {
    const logoutRes = await app.request('/api/auth/logout', { method: 'POST' });
    expect(logoutRes.status).toBe(200);
    const setCookieHeader = logoutRes.headers.get('set-cookie') ?? '';
    expect(setCookieHeader.toLowerCase()).toContain('automate_session=');
  });
});
