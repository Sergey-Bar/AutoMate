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

  describe('login rate limiting', () => {
    const limited = { ...options, loginRateLimit: { limit: 3, windowMs: 60_000 } };

    it('refuses repeated failures with 429 and a Retry-After', async () => {
      const { app } = createAuthRoutes(limited);
      const api = new Hono().route('/', app);
      const attempt = async (apiKey: string): Promise<Response> =>
        api.request('/api/v1/auth/login', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.0.0.1' },
          body: JSON.stringify({ apiKey }),
        });

      for (let index = 0; index < 3; index += 1) {
        expect((await attempt(`guess-${index}`)).status).toBe(401);
      }
      const limitedResponse = await attempt('guess-3');
      expect(limitedResponse.status).toBe(429);
      expect(limitedResponse.headers.get('retry-after')).toBeTruthy();
      expect(((await limitedResponse.json()) as { code: string }).code).toBe('LOGIN_RATE_LIMITED');
    });

    it('still accepts a valid key that has not exhausted its own budget', async () => {
      const { app } = createAuthRoutes(limited);
      const api = new Hono().route('/', app);
      const login = await api.request('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.0.0.2' },
        body: JSON.stringify({ apiKey: 'installation-key' }),
      });
      expect(login.status).toBe(200);
    });

    it('refuses one key guessed from many addresses once the key budget is spent', async () => {
      const { app } = createAuthRoutes(limited);
      const api = new Hono().route('/', app);
      const attempt = async (index: number): Promise<Response> =>
        api.request('/api/v1/auth/login', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.0.1.${index}` },
          body: JSON.stringify({ apiKey: 'installation-key-but-wrong' }),
        });
      for (let index = 0; index < 3; index += 1) expect((await attempt(index)).status).toBe(401);
      // A fresh address, same guessed key: the per-IP budget is untouched but
      // the per-key budget is not, so the guess is still refused.
      expect((await attempt(9)).status).toBe(429);
    });
  });
});
