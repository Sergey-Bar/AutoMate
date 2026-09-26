/**
 * auth.ts — Hono middleware for API key authentication
 *
 * Reads `Authorization: Bearer <token>` from the request and validates it
 * timing-safely against the configured AUTOMATE_API_KEY.
 *
 * Two bypass lists, both explicit and exhaustive:
 *   - PUBLIC_PATHS — no credential of any kind.
 *   - RUNNER_TOKEN_PATHS — authenticated by a *runner* token instead, inside
 *     the handler via `authenticateRunner`. This used to be a `startsWith`
 *     over `/api/v1/runners/` and `/api/v1/jobs/`, which meant any route
 *     mounted later under those prefixes silently inherited open access.
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

/**
 * Every route that authenticates with a runner token rather than the API key.
 * `:name` matches exactly one path segment. A new route under `/api/v1/jobs/`
 * or `/api/v1/runners/` is protected by default and must be added here
 * deliberately.
 */
const RUNNER_TOKEN_PATHS: readonly string[] = [
  '/api/v1/runners/register',
  '/api/v1/runners/:runnerId/heartbeat',
  '/api/v1/runners/:runnerId/jobs/claim',
  '/api/v1/runner/v1/enroll',
  '/api/v1/runner/v1/sync',
  '/api/v1/runner/v1/jobs/:jobId/events/batch',
  '/api/v1/jobs/:jobId/events',
  '/api/v1/jobs/:jobId/events/batch',
  '/api/v1/jobs/:jobId/artifacts',
  '/api/v1/jobs/:jobId/complete',
];

function matchesPattern(path: string, pattern: string): boolean {
  const actual = path.split('/');
  const expected = pattern.split('/');
  if (actual.length !== expected.length) return false;
  return expected.every((segment, index) => segment.startsWith(':') || segment === actual[index]);
}

function isPublicPath(path: string): boolean {
  if (PUBLIC_PATHS.has(path)) return true;
  return RUNNER_TOKEN_PATHS.some((pattern) => matchesPattern(path, pattern));
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
      // A database blip must not turn every authenticated request into an
      // unhandled 500. Fall through to the API-key path instead.
      let session: unknown = null;
      try {
        session = await sessionValidator(sessionToken);
      } catch (error) {
        console.error('session validation failed', {
          path: c.req.path,
          error: error instanceof Error ? error.message : String(error),
        });
      }
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
