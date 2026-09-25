import { Hono } from 'hono';
import { validateApiKey } from '@automate/auth';
import { deleteCookie, getSignedCookie, setSignedCookie } from 'hono/cookie';
import { z } from 'zod';

const SESSION_COOKIE_NAME = 'automate_session';
const SESSION_COOKIE_VALUE = 'authenticated';
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 12;

const LoginBodySchema = z.object({
  apiKey: z.string().min(1),
});

interface CreateAuthRoutesOptions {
  getApiKey: () => string | undefined;
  getCookieSecret: () => string | undefined;
  isProduction: () => boolean;
}

export function createAuthRoutes(options: CreateAuthRoutesOptions): Hono {
  const auth = new Hono();

  auth.post('/api/auth/login', async (c) => {
    const payload = await c.req.json().catch(() => null);
    const parsed = LoginBodySchema.safeParse(payload);
    if (!parsed.success) {
      return c.json({ error: 'Invalid request' }, 400);
    }

    const configuredApiKey = options.getApiKey();
    if (configuredApiKey === undefined) {
      return c.json({ ok: true, authMode: 'open' as const }, 200);
    }

    if (!validateApiKey(parsed.data.apiKey, configuredApiKey)) {
      return c.json({ error: 'Invalid API key' }, 401);
    }

    const cookieSecret = options.getCookieSecret();
    if (!cookieSecret) {
      return c.json({ error: 'Server auth configuration is missing' }, 500);
    }

    await setSignedCookie(c, SESSION_COOKIE_NAME, SESSION_COOKIE_VALUE, cookieSecret, {
      httpOnly: true,
      sameSite: 'Lax',
      secure: options.isProduction(),
      path: '/',
      maxAge: SESSION_MAX_AGE_SECONDS,
    });

    return c.json({ ok: true }, 200);
  });

  auth.post('/api/auth/logout', (c) => {
    deleteCookie(c, SESSION_COOKIE_NAME, { path: '/' });
    return c.json({ ok: true }, 200);
  });

  auth.get('/api/auth/session', async (c) => {
    const configuredApiKey = options.getApiKey();
    if (configuredApiKey === undefined) {
      return c.json({ authenticated: true, authMode: 'open' as const }, 200);
    }

    const cookieSecret = options.getCookieSecret();
    if (!cookieSecret) {
      return c.json({ authenticated: false }, 200);
    }

    const sessionCookie = await getSignedCookie(c, cookieSecret, SESSION_COOKIE_NAME);
    const authenticated = sessionCookie === SESSION_COOKIE_VALUE;
    return c.json({ authenticated }, 200);
  });

  return auth;
}
