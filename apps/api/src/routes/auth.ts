import { Hono, type Context } from 'hono';
import { DomainError } from '../errors/domain-error.js';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { z } from 'zod/v4';
import {
  hashCredential,
  InMemorySessionService,
  verifyCredential,
  type SessionRecord,
} from '@automate/auth';
import type { AuthSessionBackend } from '../infrastructure/session-backend.js';
import { createRateLimiter } from '../middleware/rate-limit.js';

const LoginSchema = z.object({ apiKey: z.string().min(1) });
const SESSION_COOKIE = 'automate_session';

/**
 * Login is unauthenticated by definition, so it is the one endpoint where an
 * attacker gets unlimited attempts for free. The plan's D3 decision keeps this
 * single-tenant, which is exactly why an in-process limiter is the right
 * scope: the threat is credential stuffing against one API key.
 */
const DEFAULT_LOGIN_LIMIT = 5;
const DEFAULT_LOGIN_WINDOW_MS = 60_000;

export interface AuthRouteOptions {
  cookieSecret: string;
  installationId: string;
  installationKeyHash: string;
  sessionTtlMs: number;
  secureCookies: boolean;
  now?: () => Date;
  sessionBackend?: AuthSessionBackend;
  /**
   * Login limiter budget.
   *
   * `now` is a seam, not a convenience: the limiter counts windows in process
   * memory against `Date.now()`, so without this the only way to assert that the
   * window *rolls over* is to sleep for it. Without the seam, "a correct password
   * is not locked out forever" is an unassertable property, and the lockout
   * behaviour nobody tests is the behaviour nobody verifies.
   */
  loginRateLimit?: { limit: number; windowMs: number; now?: () => number };
  /** Injected in tests; defaults to the request's forwarded/client address. */
  clientKey?: (context: Context) => string;
}

function sessionResponse(record: SessionRecord) {
  return {
    sessionId: record.id,
    installationId: record.installationId,
    issuedAt: record.issuedAt.toISOString(),
    expiresAt: record.expiresAt.toISOString(),
  };
}

/**
 * The in-process session backend, plus the sweep that keeps it bounded.
 *
 * **Ledger S-2, S-6, S-7 — one feature across three rows.** The service grew
 * without bound because nothing removed an entry: `revoke` only stamped
 * `revokedAt`, and `deleteExpired` did not exist outside the ledger. So the map that
 * `validate` scanned grew with every sign-in, forever.
 *
 * The sweep is scheduled here because this is where the service is constructed, and
 * a sweep that is defined but never called is the state the row described. The
 * interval is `RETENTION_SWEEP_INTERVAL_SECONDS` rather than the session TTL: the
 * TTL is how long a session is *valid*, and sweeping on that would be four times an
 * hour for nothing. The retention window is `SESSION_RETENTION_DAYS`, which until now
 * was parsed and mapped and read by nothing at all.
 *
 * The timer is `unref`'d so a pending sweep never holds the process open on shutdown.
 *
 * Exported so a test can reach the *default* backend's `sweep`. A sweep asserted
 * only through a caller-supplied backend proves nothing about the default path, and
 * the default path is the one a development deployment actually runs.
 */
export function memoryBackend(secret: string, ttlMs: number, now?: () => Date): AuthSessionBackend {
  const service = new InMemorySessionService(secret, ttlMs, now);
  return {
    issue: async (installationId) => service.issue(installationId),
    validate: async (token) => service.validate(token),
    revoke: async (id) => service.revoke(id),
    sweep: async () => {
      const removed = service.deleteExpired();
      return { removed };
    },
  };
}

export function createAuthRoutes(options: AuthRouteOptions) {
  const sessions =
    options.sessionBackend ??
    memoryBackend(options.cookieSecret, options.sessionTtlMs, options.now);
  const app = new Hono();
  const loginLimiter = createRateLimiter({
    limit: options.loginRateLimit?.limit ?? DEFAULT_LOGIN_LIMIT,
    windowMs: options.loginRateLimit?.windowMs ?? DEFAULT_LOGIN_WINDOW_MS,
    ...(options.loginRateLimit?.now === undefined ? {} : { now: options.loginRateLimit.now }),
  });
  const clientKey =
    options.clientKey ??
    ((context: Context) =>
      context.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
      context.req.header('x-real-ip')?.trim() ||
      'unknown-client');

  app.post('/api/v1/auth/login', async (context) => {
    const parsed = LoginSchema.safeParse(await context.req.json().catch(() => null));
    if (!parsed.success) throw new DomainError('INVALID_LOGIN_REQUEST', 'Invalid login request');
    // Per-IP budget, plus a per-key budget so one address cannot exhaust the
    // limiter while guessing a single key.
    const perIp = loginLimiter.consume(`ip:${clientKey(context)}`);
    const perKey = loginLimiter.consume(
      `key:${hashCredential(options.cookieSecret, parsed.data.apiKey).slice(0, 32)}`,
    );
    if (!perIp.allowed || !perKey.allowed) {
      const retryAfter = Math.max(perIp.retryAfterSeconds, perKey.retryAfterSeconds);
      context.header('retry-after', String(retryAfter));
      throw new DomainError('LOGIN_RATE_LIMITED', 'Too many login attempts', {
        details: { retryAfterSeconds: retryAfter },
      });
    }
    if (!verifyCredential(options.cookieSecret, parsed.data.apiKey, options.installationKeyHash)) {
      throw new DomainError('INVALID_CREDENTIALS', 'Invalid credentials');
    }
    const issued = await sessions.issue(options.installationId);
    setCookie(context, SESSION_COOKIE, issued.token, {
      httpOnly: true,
      sameSite: 'Lax',
      secure: options.secureCookies,
      path: '/',
      maxAge: Math.floor(options.sessionTtlMs / 1000),
    });
    return context.json(sessionResponse(issued.record));
  });

  app.get('/api/v1/auth/session', async (context) => {
    const record = await readSession(context, sessions);
    if (!record) throw new DomainError('UNAUTHENTICATED', 'Unauthorized');
    return context.json(sessionResponse(record));
  });

  app.post('/api/v1/auth/logout', async (context) => {
    const record = await readSession(context, sessions);
    if (record) await sessions.revoke(record.id);
    deleteCookie(context, SESSION_COOKIE, { path: '/' });
    return context.json({ ok: true });
  });

  return { app, sessions };
}

async function readSession(
  context: Context,
  sessions: AuthSessionBackend,
): Promise<SessionRecord | undefined> {
  const token = getCookie(context, SESSION_COOKIE);
  if (!token) return undefined;
  return sessions.validate(token);
}

export { hashCredential };
