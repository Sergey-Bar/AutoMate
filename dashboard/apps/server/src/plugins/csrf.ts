/**
 * plugins/csrf.ts — Cross-Site Request Forgery protection
 *
 * Protects cookie-authenticated mutation endpoints (POST/PUT/DELETE/PATCH)
 * from CSRF attacks by requiring one of:
 *   1. A matching `Origin` header (browser-sent for cross-origin requests)
 *   2. A `X-Requested-With` header (custom headers require CORS preflight)
 *
 * Exempt routes:
 *   - Non-mutation methods (GET, HEAD, OPTIONS)
 *   - Requests with `Authorization` header (API key / Bearer token clients)
 *   - Requests with `X-Service-Auth` header (service-to-service)
 *   - SAML callback (POST from IdP, no Origin/custom header)
 *   - Reporter WebSocket (separate port, token-authed)
 */
import type { FastifyInstance } from 'fastify';

const MUTATION_METHODS = new Set(['POST', 'PUT', 'DELETE', 'PATCH']);

const EXEMPT_PATHS = [
  '/api/auth/saml/callback',   // IdP posts back without custom headers
  '/api/auth/login',           // Login form POST (no session cookie yet)
  '/api/auth/bootstrap',       // Bootstrap initial key creation
];

/**
 * Determines the allowed origin from CORS_ORIGIN env var.
 * Falls back to localhost:5173 in development.
 */
function getAllowedOrigin(): string {
  return process.env.CORS_ORIGIN ?? 'http://localhost:5173';
}

/**
 * Check whether a request is CSRF-safe.
 * Returns true if the request should be allowed, false if it should be rejected.
 */
export function isCsrfSafe(opts: {
  method: string;
  url: string;
  origin: string | undefined;
  xRequestedWith: string | undefined;
  authorization: string | undefined;
  xServiceAuth: string | undefined;
}): boolean {
  // Non-mutation requests are safe
  if (!MUTATION_METHODS.has(opts.method)) return true;

  // API key / Bearer token clients are not vulnerable to CSRF
  if (opts.authorization) return true;

  // Service-to-service requests use their own auth
  if (opts.xServiceAuth) return true;

  // Exempt paths (SAML callback, login, bootstrap)
  for (const exemptPath of EXEMPT_PATHS) {
    if (opts.url === exemptPath || opts.url.startsWith(exemptPath + '?')) return true;
  }

  // Custom header check (browsers don't send custom headers without preflight)
  if (opts.xRequestedWith) return true;

  // Origin header check
  if (opts.origin) {
    const allowed = getAllowedOrigin();
    // Support comma-separated origins in CORS_ORIGIN
    const allowedOrigins = allowed.split(',').map((o) => o.trim());
    return allowedOrigins.includes(opts.origin);
  }

  // No indicators of a legitimate request — reject
  return false;
}

export async function registerCsrfPlugin(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', async (request, reply) => {
    const safe = isCsrfSafe({
      method: request.method,
      url: request.url.split('?')[0] ?? request.url,
      origin: request.headers.origin,
      xRequestedWith: request.headers['x-requested-with'] as string | undefined,
      authorization: request.headers.authorization,
      xServiceAuth: request.headers['x-service-auth'] as string | undefined,
    });

    if (!safe) {
      return reply.code(403).send({ error: 'CSRF validation failed' });
    }
  });
}
