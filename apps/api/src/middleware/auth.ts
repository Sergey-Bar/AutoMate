/**
 * auth.ts — Hono middleware for API key authentication
 *
 * Reads `Authorization: Bearer <token>` from the request and validates it against the
 * configured credential. Which comparison runs is decided in `isAuthorised` below, and
 * it is a property of the deployment rather than a fallback chain: a deployment with a
 * pepper and an installation-key hash verifies a peppered HMAC, and a deployment
 * without one compares against the plaintext secret it holds.
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
import { DomainError } from '../errors/domain-error.js';
import { getCookie } from 'hono/cookie';
import { verifyCredential, verifySharedSecret } from '@automate/auth';
import { bearerToken } from '../http/bearer-token.js';

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
        // `callerSafe`, because a 503 that says "internal error" tells the operator
        // nothing and files a missing key as a crash. This is a checklist item, and the
        // person who has to fix it is the one reading the response.
        throw new DomainError('NOT_CONFIGURED', 'Authentication is not configured', {
          callerSafe: true,
        });
      }
      await next();
      return;
    }
    const provided = bearerToken(c.req.header('Authorization'));
    if (provided === undefined) {
      throw new DomainError('UNAUTHENTICATED', 'Unauthorized');
    }
    if (!isAuthorised(provided, { apiKey, expectedKeyHash, credentialSecret })) {
      throw new DomainError('UNAUTHENTICATED', 'Unauthorized');
    }
    await next();
  };
}

/**
 * The one place that decides whether a presented Bearer token is acceptable.
 *
 * Two arms, and the choice between them is not a fallback — it is which secret this
 * deployment actually holds:
 *
 *  - A pepper (`credentialSecret`) and an installation-key hash. The token is
 *    peppered-HMAC'd and compared to the hash, so the stored form is never the secret.
 *    This is the production path whenever a database is configured.
 *  - Neither. The in-memory path, where the process holds `AUTOMATE_API_KEY` in
 *    plaintext. The comparison is then between two plaintext secrets the process
 *    already has, in constant time, and `verifySharedSecret` says so in its name.
 *
 * This arm used to call `validateApiKey(provided, apiKey ?? '')`, whose second
 * parameter was named `storedHash` and which compared the presented value to whatever
 * it was given. Given a plaintext key that happened to work; given a real hash it
 * compared a secret against a hash and returned `false` — correct answer, wrong reason,
 * and a signature that promised a check the code never did.
 */
function isAuthorised(
  provided: string,
  parts: {
    apiKey: string | undefined;
    expectedKeyHash: string | undefined;
    credentialSecret: string | undefined;
  },
): boolean {
  if (parts.expectedKeyHash && parts.credentialSecret) {
    return verifyCredential(parts.credentialSecret, provided, parts.expectedKeyHash);
  }
  if (parts.apiKey) {
    return verifySharedSecret(provided, parts.apiKey);
  }
  return false;
}
