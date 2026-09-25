import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { hashCredential } from '@automate/auth';
import { createAuthRoutes } from './auth.js';

const cookieSecret = 'c'.repeat(32);
const installationKeyHash = hashCredential(cookieSecret, 'installation-key');
const options = {
  cookieSecret,
  installationId: 'installation-1',
  installationKeyHash,
  sessionTtlMs: 60_000,
  secureCookies: false,
  now: () => new Date('2026-09-25T00:00:00.000Z'),
};

describe('auth routes', () => {
  it('issues an HttpOnly session and revokes it on logout', async () => {
    const { app } = createAuthRoutes(options);
    const api = new Hono().route('/', app);
    const login = await api.request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ apiKey: 'installation-key' }),
    });
    expect(login.status).toBe(200);
    const cookie = login.headers.get('set-cookie');
    expect(cookie).toContain('automate_session=');
    expect(cookie).toContain('HttpOnly');
    const session = await api.request('/api/v1/auth/session', {
      headers: { cookie: cookie ?? '' },
    });
    expect(session.status).toBe(200);
    const logout = await api.request('/api/v1/auth/logout', {
      method: 'POST',
      headers: { cookie: cookie ?? '' },
    });
    expect(logout.status).toBe(200);
    const revoked = await api.request('/api/v1/auth/session', {
      headers: { cookie: cookie ?? '' },
    });
    expect(revoked.status).toBe(401);
  });

  it('rejects invalid credentials and malformed requests', async () => {
    const { app } = createAuthRoutes(options);
    const api = new Hono().route('/', app);
    expect((await api.request('/api/v1/auth/login', { method: 'POST', body: '{}' })).status).toBe(
      400,
    );
    expect(
      (
        await api.request('/api/v1/auth/login', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ apiKey: 'wrong-key' }),
        })
      ).status,
    ).toBe(401);
  });
});
