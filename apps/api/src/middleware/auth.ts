/**
 * auth.ts — Hono middleware for API key authentication
 *
 * Reads `Authorization: Bearer <token>` from the request and validates it
 * timing-safely against the configured AUTOMATE_API_KEY.
 *
 * Public paths that bypass authentication:
 *   - /health
 *   - /api/v1/health
 *   - /api/v1/features
 *   - /api/auth/login
 *   - /api/auth/logout
 *   - /api/auth/session
 *   - /api/v1/reporter/*  (has its own REPORTER_SECRET auth)
 *
 * All other paths require either a valid Bearer token or a valid signed
 * session cookie. Missing or invalid credentials
 * receive a 401 JSON response: { error: 'Unauthorized' }.
 */
import type { Context, Next } from 'hono';
import { validateApiKey } from '@automate/auth';
import { getSignedCookie } from 'hono/cookie';

/** Paths that do not require API key authentication. */
const PUBLIC_PATHS = new Set([
  '/health',
  '/api/v1/health',
  '/api/v1/features',
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/session',
]);

/** Path prefix that uses its own reporter secret auth. */
const REPORTER_PREFIX = '/api/v1/reporter/';
const SESSION_COOKIE_NAME = 'automate_session';

function isPublicPath(path: string): boolean {
  if (PUBLIC_PATHS.has(path)) return true;
  if (path.startsWith(REPORTER_PREFIX)) return true;
  return false;
}

/**
 * Creates an auth middleware that protects all non-public routes.
 *
 * @param apiKeyOrGetter  Either a static API key string, or a zero-argument
 *                        function that returns the key at request time.
 *                        Defaults to reading `process.env['AUTOMATE_API_KEY']`
 *                        at request time (lazy — supports test env overrides).
 *                        Pass `undefined` explicitly to force open mode.
 */
export function createAuthMiddleware(
  apiKeyOrGetter: string | undefined | (() => string | undefined) = () =>
    process.env['AUTOMATE_API_KEY'],
  cookieSecretOrGetter: string | undefined | (() => string | undefined) = () =>
    process.env['COOKIE_SECRET'] ?? process.env['SESSION_SECRET'],
) {
  return async function authMiddleware(c: Context, next: Next): Promise<Response | void> {
    // Resolve the API key — either static or dynamically from the getter.
    const apiKey =
      typeof apiKeyOrGetter === 'function' ? apiKeyOrGetter() : apiKeyOrGetter;

    // No key configured — open mode; pass all requests through.
    if (apiKey === undefined) {
      await next();
      return;
    }

    // Public paths bypass authentication.
    if (isPublicPath(c.req.path)) {
      await next();
      return;
    }

    const authHeader = c.req.header('Authorization');
    if (authHeader?.startsWith('Bearer ')) {
      const provided = authHeader.slice(7);
      if (validateApiKey(provided, apiKey)) {
        await next();
        return;
      }
    }

    const cookieSecret =
      typeof cookieSecretOrGetter === 'function'
        ? cookieSecretOrGetter()
        : cookieSecretOrGetter;

    if (cookieSecret) {
      const sessionCookie = await getSignedCookie(c, cookieSecret, SESSION_COOKIE_NAME);
      if (sessionCookie === 'authenticated') {
        await next();
        return;
      }
    }

    return c.json({ error: 'Unauthorized' }, 401);
  };
}
