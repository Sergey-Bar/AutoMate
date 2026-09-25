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
 *   - /api/v1/reporter/*  (has its own REPORTER_SECRET auth)
 *
 * All other paths require a valid Bearer token. Missing or invalid tokens
 * receive a 401 JSON response: { error: 'Unauthorized' }.
 */
import type { Context, Next } from 'hono';
import { getCookie } from 'hono/cookie';
import { validateApiKey, verifyCredential } from '@automate/auth';

/** Paths that do not require API key authentication. */
const PUBLIC_PATHS = new Set([
  '/health',
  '/api/v1/health',
  '/api/v1/ready',
  '/ready',
  '/api/v1/features',
  '/api/v1/auth/login',
  '/api/v1/auth/session',
  '/api/v1/auth/logout',
  '/api/v1/reporter/events',
  '/api/v1/reporter/upload',
  '/api/v1/reporter/results',
]);

function isPublicPath(path: string): boolean {
  if (PUBLIC_PATHS.has(path)) return true;
  return (
    path.startsWith('/api/v1/runner/v1/') ||
    path.startsWith('/api/v1/runners/') ||
    path.startsWith('/api/v1/jobs/')
  );
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
  sessionValidator?: (token: string) => unknown | Promise<unknown>,
  expectedKeyHash?: string,
  credentialSecret?: string,
) {
  return async function authMiddleware(c: Context, next: Next): Promise<Response | void> {
    if (isPublicPath(c.req.path)) {
      await next();
      return;
    }
    const sessionToken = getCookie(c, 'automate_session');
    if (sessionToken && sessionValidator) {
      const session = await sessionValidator(sessionToken);
      if (session) {
        c.set('session', session);
        await next();
        return;
      }
    }
    const apiKey = typeof apiKeyOrGetter === 'function' ? apiKeyOrGetter() : apiKeyOrGetter;
    if (apiKey === undefined && !expectedKeyHash) {
      if (process.env['NODE_ENV'] === 'production') {
        return c.json({ error: 'Authentication is not configured' }, 503);
      }
      await next();
      return;
    }
    const authHeader = c.req.header('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    const provided = authHeader.slice(7);
    if (
      !(expectedKeyHash && credentialSecret
        ? verifyCredential(credentialSecret ?? '', provided, expectedKeyHash)
        : validateApiKey(provided, apiKey ?? ''))
    ) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    await next();
  };
}
