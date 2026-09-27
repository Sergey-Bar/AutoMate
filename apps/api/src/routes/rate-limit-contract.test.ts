import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createReporterRoutes } from './reporter.js';
import { createAuthRoutes } from './auth.js';
import { InMemoryRunRepository } from '../repositories/in-memory-run-repository.js';
import { hashCredential } from '@automate/auth';

/**
 * Rate limiting, and the routes that deliberately have none.
 *
 * The rate limiter existed and had unit tests for its arithmetic. Nothing
 * asserted **which routes were behind it**, so a route could be added to the
 * mounted app with no limiter and nothing would fail — which is how a
 * credential-stuffing target is created by accident rather than by decision.
 *
 * So this file has two halves, and the second is the important one:
 *
 *   - the limiter's contract as the API actually uses it (429, `Retry-After`,
 *     a stable code, and an exact-window boundary), and
 *   - an explicit list of the unauthenticated or ingestion routes that are
 *     **not** limited, so the next person adding a route has to add a name to
 *     this file rather than silently shipping an open endpoint.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

const REPORTER_SECRET = 'rate-limit-reporter-secret';
const COOKIE_SECRET = 'rate-limit-cookie-secret-32-characters-long';
const API_KEY = 'rate-limit-installation-key';

/**
 * Routes reachable without a credential, and whether each is limited.
 *
 * `limited: false` is a decision with a reason, not an omission. Every entry is
 * the *mounted* path, and the check below fails if a route appears in the
 * composed app and not in this list — so the list cannot silently go stale.
 */
const UNAUTHENTICATED_ROUTES: ReadonlyArray<{
  method: string;
  path: string;
  limited: boolean;
  why: string;
}> = [
  {
    method: 'POST',
    path: '/api/v1/auth/login',
    limited: true,
    why: 'the only unauthenticated endpoint an attacker can retry freely, so credential stuffing is its whole threat model',
  },
  {
    method: 'GET',
    path: '/api/v1/auth/session',
    limited: false,
    why: 'reads a cookie the caller already holds; it grants nothing, and a limiter here would only add a failure mode to a page load',
  },
  {
    method: 'POST',
    path: '/api/v1/auth/logout',
    limited: false,
    why: "revokes the caller's own session; there is nothing to gain by repeating it",
  },
  {
    method: 'GET',
    path: '/health',
    limited: false,
    why: 'a liveness probe; refusing it would take the container out of rotation',
  },
  {
    method: 'GET',
    path: '/api/v1/health',
    limited: false,
    why: 'the same probe, versioned',
  },
  {
    method: 'GET',
    path: '/ready',
    limited: false,
    why: 'a readiness probe; a 429 here is indistinguishable from not-ready to an orchestrator',
  },
  {
    method: 'GET',
    path: '/api/v1/ready',
    limited: false,
    why: 'the same probe, versioned',
  },
  {
    method: 'GET',
    path: '/api/v1/features',
    limited: false,
    why: 'a static capability manifest with no per-caller data',
  },
];

/** The reporter ingestion routes, which are credentialed and limited. */
const INGESTION_ROUTES: ReadonlyArray<{ method: string; path: string }> = [
  { method: 'POST', path: '/api/v1/reporter/events' },
  { method: 'POST', path: '/api/v1/reporter/upload' },
];

function reporterApp(limit?: number) {
  return createReporterRoutes(REPORTER_SECRET, {
    repository: new InMemoryRunRepository(),
    ...(limit === undefined ? {} : {}),
  });
}

function authApp(limit: number) {
  return createAuthRoutes({
    cookieSecret: COOKIE_SECRET,
    installationId: '00000000-0000-4000-9000-0000000000cc',
    installationKeyHash: hashCredential(COOKIE_SECRET, API_KEY),
    sessionTtlMs: 60_000,
    secureCookies: false,
    loginRateLimit: { limit, windowMs: 60_000, now: () => 0 },
    clientKey: () => 'a-single-client',
  }).app;
}

describe('the rate limiter contract', () => {
  it('answers 429 with a stable code and a usable Retry-After', async () => {
    const app = authApp(2);
    const attempt = () =>
      app.request('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ apiKey: 'wrong' }),
      });

    await attempt();
    await attempt();
    const limited = await attempt();
    expect(limited.status).toBe(429);

    const body = (await limited.json()) as { code: string; retryAfterSeconds: number };
    // A 429 with a prose `error` and no `code` cannot be handled by a client,
    // and cannot be alerted on by an operator reading logs.
    expect(body.code).toBe('LOGIN_RATE_LIMITED');
    expect(body.retryAfterSeconds).toBe(60);
    // The header is what a generic HTTP client obeys; the body field is what a
    // bespoke one reads. They disagreeing is a client that trusts the wrong one.
    expect(limited.headers.get('retry-after')).toBe('60');
  });

  it('allows exactly `limit` requests and refuses the one after', async () => {
    const app = authApp(3);
    const attempt = () =>
      app.request('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ apiKey: 'wrong' }),
      });
    const statuses = await Promise.all(Array.from({ length: 5 }, () => attempt())).then(
      (responses) => Promise.all(responses.map((response) => response.status)),
    );
    // Three attempts are the budget; two must be refused. A limiter that lets the
    // fourth through is worse than none, because it looks like it is working.
    expect(statuses.slice(0, 3).every((status) => status === 401)).toBe(true);
    expect(statuses.slice(3).every((status) => status === 429)).toBe(true);
  });

  it('does not consume the budget for a request that never reaches the credential check', async () => {
    // Asserted in `auth-session-lifecycle.test.ts` for a malformed body. Here the
    // point is the *unauthenticated* dimension: a flood from one address must not
    // be able to lock out a different address, or a shared NAT in front of a
    // corporate proxy is a denial-of-service on the product.
    const routes = createAuthRoutes({
      cookieSecret: COOKIE_SECRET,
      installationId: '00000000-0000-4000-9000-0000000000cc',
      installationKeyHash: hashCredential(COOKIE_SECRET, API_KEY),
      sessionTtlMs: 60_000,
      secureCookies: false,
      loginRateLimit: { limit: 2, windowMs: 60_000, now: () => 0 },
      clientKey: (context) => context.req.header('x-test-client') ?? 'unknown-client',
    }).app;

    const attempt = (client: string, apiKey = 'wrong') =>
      routes.request('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-test-client': client },
        body: JSON.stringify({ apiKey }),
      });

    for (let index = 0; index < 6; index += 1) await attempt('noisy-neighbour');
    // A *different* key, so only the per-address budget is in play. Using the
    // flood's key would measure the per-key budget instead, which is a
    // different and already-covered property.
    const victim = await attempt('the-victim', 'another-wrong-key');
    // The correct credential from an address that was not flooded still works.
    expect(victim.status).toBe(401);
    const loggedIn = await attempt('the-victim', API_KEY);
    expect(loggedIn.status).toBe(200);
  });
});

describe('reporter ingestion is credentialed', () => {
  it('refuses a request with no token, before it can be a flood', async () => {
    for (const route of INGESTION_ROUTES) {
      const app = reporterApp();
      const response = await app.request(route.path, {
        method: route.method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ runId: 'run-1' }),
      });
      expect(response.status, route.path).toBe(401);
    }
  });

  it('distinguishes a missing token from a wrong one', async () => {
    const app = reporterApp();
    for (const route of INGESTION_ROUTES) {
      const missing = await app.request(route.path, {
        method: route.method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ runId: 'run-1' }),
      });
      const wrong = await app.request(route.path, {
        method: route.method,
        headers: { 'content-type': 'application/json', authorization: 'Bearer not-the-secret' },
        body: JSON.stringify({ runId: 'run-1' }),
      });
      // 401 for "who are you" and 403 for "you are known and wrong" let a client
      // tell a configuration mistake from a rejected credential. Collapsing them
      // into one code makes an operator debug the wrong thing.
      expect(missing.status, `${route.path} missing`).toBe(401);
      expect(wrong.status, `${route.path} wrong`).toBe(403);
    }
  });

  it('rejects a query-parameter token by default', async () => {
    const app = reporterApp();
    for (const route of INGESTION_ROUTES) {
      // `?token=` lands in access logs, browser history and referrer headers. The
      // compatibility switch exists but is off unless someone turns it on.
      const response = await app.request(`${route.path}?token=${REPORTER_SECRET}`, {
        method: route.method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ runId: 'run-1' }),
      });
      expect(response.status, route.path).toBe(401);
    }
  });

  it('accepts a query-parameter token only when compatibility is explicitly enabled', async () => {
    const app = createReporterRoutes(REPORTER_SECRET, {
      repository: new InMemoryRunRepository(),
      allowQueryToken: true,
    });
    const response = await app.request(
      `/api/v1/reporter/events?token=${encodeURIComponent(REPORTER_SECRET)}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'run:start', runId: 'compat-run', payload: {} }),
      },
    );
    expect(response.status).toBe(202);
  });

  it('rejects an empty query token rather than treating it as absent', async () => {
    const app = createReporterRoutes(REPORTER_SECRET, {
      repository: new InMemoryRunRepository(),
      allowQueryToken: true,
    });
    // `?token=` is a *supplied but empty* credential, which is a different thing
    // from a missing one and must not fall through to open mode.
    const response = await app.request('/api/v1/reporter/events?token=', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'run:start', runId: 'empty-token', payload: {} }),
    });
    expect(response.status).toBe(401);
  });

  it('refuses a body over the cap with 413 rather than parsing it', async () => {
    const app = reporterApp();
    const oversized = 'x'.repeat(6 * 1024 * 1024);
    const response = await app.request('/api/v1/reporter/events', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${REPORTER_SECRET}`,
      },
      body: JSON.stringify({ type: 'run:start', runId: 'big', payload: oversized }),
    });
    // A 400 here would mean the cap was enforced by the schema, which means the
    // body was already read into memory.
    expect(response.status).toBe(413);
  });
});

describe('the unthrottled set is declared', () => {
  it('lists every route the composed app serves without a credential', () => {
    // The manifest of record.
    const declared = new Set(
      UNAUTHENTICATED_ROUTES.map((route) => `${route.method} ${route.path}`),
    );
    const served = unauthenticatedRoutes();

    expect(served.length, 'no unauthenticated routes were discovered at all').toBeGreaterThan(0);
    for (const route of served) {
      expect(
        declared.has(`${route.method} ${route.path}`),
        `${route.method} ${route.path} is reachable without a credential but is not in ` +
          'UNAUTHENTICATED_ROUTES. Add it with a reason: an unlisted route is an ' +
          'unreviewed one.',
      ).toBe(true);
    }
  });

  it('claims no route the API does not serve', () => {
    const served = new Set(unauthenticatedRoutes().map((r) => `${r.method} ${r.path}`));
    for (const route of UNAUTHENTICATED_ROUTES) {
      expect(
        served.has(`${route.method} ${route.path}`),
        `${route.method} ${route.path} is listed in UNAUTHENTICATED_ROUTES but the API does ` +
          'not serve it; a stale entry hides a real one',
      ).toBe(true);
    }
  });

  it('gives every unthrottled route a reason, because "not limited" is a decision', () => {
    for (const route of UNAUTHENTICATED_ROUTES) {
      expect(route.why.length, `${route.method} ${route.path}`).toBeGreaterThan(20);
    }
  });
});

/**
 * The route factories `index.ts` mounts *outside* the credentialed prefix.
 *
 * A source scan, deliberately: the alternative is booting the composition root,
 * which starts a server as an import side effect, and the property being checked
 * is about which routes a caller can reach unauthenticated — which is a fact
 * about the source, not about a running process.
 *
 * Read per-file rather than by following `app.route(…)` calls, because the mounts
 * in `index.ts` are not uniform — one is `app.route('/', createHealthRoutes({…}))`
 * across several lines — and a parser for that shape would be more fragile than
 * the thing it is checking.
 */
const UNAUTHENTICATED_FACTORIES: ReadonlyArray<{ file: string; exportedAs: string }> = [
  { file: 'routes/health.ts', exportedAs: 'createHealthRoutes' },
  { file: 'routes/auth.ts', exportedAs: 'createAuthRoutes' },
];

function unauthenticatedRoutes(): Array<{ method: string; path: string }> {
  const indexSource = readFileSync(path.join(root, 'apps/api/src/index.ts'), 'utf8');
  const found: Array<{ method: string; path: string }> = [];

  for (const { file, exportedAs } of UNAUTHENTICATED_FACTORIES) {
    // If the factory stopped being mounted, there is nothing to enumerate, and the
    // manifest should say so rather than go quietly stale.
    if (!indexSource.includes(exportedAs)) continue;
    const source = readFileSync(path.join(root, 'apps/api/src', file), 'utf8');
    for (const entry of source.matchAll(/\.(?:get|post|patch|put|delete)\(\s*'([^']+)'/g)) {
      found.push({
        method: (entry[0] ?? '').match(/\.(\w+)\(/)?.[1]?.toUpperCase() ?? 'GET',
        path: entry[1] ?? '',
      });
    }
  }
  return found;
}
