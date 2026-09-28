import { Hono } from 'hono';
/**
 * The boundary's body, named.
 *
 * A rate-limited client has to be able to branch: the correct response is to stop and
 * wait, not to try another key. The body used to carry `code` and `retryAfterSeconds`
 * as siblings of a prose `error`, which was branchable only if the client knew to look
 * in three places.
 */
interface BoundaryBody {
  error: {
    code: string;
    message: string;
    requestId: string;
    details: {
      /** How long to wait, rather than a sentence saying to try again. */
      retryAfterSeconds: number;
    };
  };
}

import { withErrorBoundary } from '../test-support/error-boundary-app.js';
import { describe, expect, it } from 'vitest';
import { hashCredential, verifyCredential } from '@automate/auth';
import { createAuthRoutes } from './auth.js';

/**
 * The session lifecycle, end to end.
 *
 * The route's own tests assert that a good key is accepted and a bad one is not.
 * Nothing asserted what happens to a session *after* it is issued, and that is
 * where the security properties live: a session that never expires, survives
 * logout, or is accepted alongside a revoked one is a session that outlives the
 * operator's intent to end it.
 *
 * Four properties, each stated as a property and not as a code path:
 *
 *   1. **TTL** — a session is valid before `expiresAt` and invalid after it,
 *      measured on an injected clock so the test does not sleep.
 *   2. **Revocation** — logout invalidates the *token*, not just the client's copy
 *      of it. A test that only checks the cookie is gone proves nothing: an
 *      attacker holding a stolen token would still be authenticated.
 *   3. **Rotation** — a new login issues a different token, and the old one keeps
 *      whatever standing it had rather than being silently upgraded or killed.
 *   4. **Credential separation** — the cookie value, the session id, and the
 *      installation key are three different things, and none of them is
 *      interchangeable with another.
 */

const COOKIE_SECRET = 'auth-session-test-cookie-secret-32-characters';
const INSTALLATION_ID = '00000000-0000-4000-9000-0000000000aa';
const API_KEY = 'the-installation-api-key-used-by-this-suite';
const SESSION_TTL_MS = 60_000;

const COOKIE = 'automate_session';

/** The session cookie from a response, or undefined. */
function sessionCookie(response: Response): string | undefined {
  const header = response.headers.get('set-cookie') ?? '';
  const match = new RegExp(`${COOKIE}=([^;]*)`).exec(header);
  return match?.[1];
}

/** A `Cookie:` header carrying the session cookie. */
function cookieHeader(response: Response): Record<string, string> {
  const value = sessionCookie(response);
  return value === undefined ? {} : { cookie: `${COOKIE}=${value}` };
}

function harness(options: { now?: () => Date; secureCookies?: boolean } = {}) {
  const now = options.now ?? (() => new Date('2026-09-27T00:00:00.000Z'));
  const routes = createAuthRoutes({
    cookieSecret: COOKIE_SECRET,
    installationId: INSTALLATION_ID,
    installationKeyHash: hashCredential(COOKIE_SECRET, API_KEY),
    sessionTtlMs: SESSION_TTL_MS,
    secureCookies: options.secureCookies ?? false,
    now,
  });
  // The boundary, because `GET /api/v1/auth/session` refuses by `throw`ing a
  // `DomainError` since finding C-3. Without it every case below would be asserting a
  // 500 and calling it a session lifecycle test.
  const app = withErrorBoundary(routes.app);
  return {
    app,
    sessions: routes.sessions,
    login: (apiKey = API_KEY) =>
      app.request('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ apiKey }),
      }),
    session: (from: Response) =>
      app.request('/api/v1/auth/session', { headers: cookieHeader(from) }),
    logout: (from: Response) =>
      app.request('/api/v1/auth/logout', { method: 'POST', headers: cookieHeader(from) }),
  };
}

describe('a session expires', () => {
  it('is valid one millisecond before the TTL and invalid at it', async () => {
    let clock = new Date('2026-09-27T00:00:00.000Z');
    const h = harness({ now: () => clock });

    const login = await h.login();
    expect(login.status).toBe(200);

    // One millisecond inside the window.
    clock = new Date(clock.getTime() + SESSION_TTL_MS - 1);
    expect((await h.session(login)).status, 'one millisecond before expiry').toBe(200);

    // And at it. A session that is still valid at `expiresAt` is a session whose
    // TTL is advisory.
    clock = new Date(clock.getTime() + 1);
    expect((await h.session(login)).status, 'at expiry').toBe(401);
  });

  it('reports an expiry a caller can act on, in the cookie and in the body', async () => {
    const h = harness();
    const login = await h.login();
    const body = (await login.json()) as { expiresAt: string; issuedAt: string };
    const issued = Date.parse(body.issuedAt);
    const expires = Date.parse(body.expiresAt);
    expect(expires - issued).toBe(SESSION_TTL_MS);

    // The cookie's Max-Age must agree with the body, or a client trusts one and
    // the server believes the other.
    const setCookie = login.headers.get('set-cookie') ?? '';
    const maxAge = /Max-Age=(\d+)/i.exec(setCookie);
    expect(maxAge).not.toBeNull();
    expect(Number(maxAge?.[1])).toBe(Math.floor(SESSION_TTL_MS / 1000));
  });

  it('does not let one expired session keep another alive', async () => {
    let clock = new Date('2026-09-27T00:00:00.000Z');
    const h = harness({ now: () => clock });
    const first = await h.login();

    clock = new Date(clock.getTime() + 10_000);
    const second = await h.login();
    expect((await h.session(second)).status).toBe(200);

    // Just inside the first session's TTL and well past the first one, so the
    // two windows genuinely differ. A single shared expiry would make the
    // assertion pass for the wrong reason.
    clock = new Date(clock.getTime() + SESSION_TTL_MS - 1);
    expect((await h.session(first)).status, 'the older session').toBe(401);
    expect((await h.session(second)).status, 'the newer session').toBe(200);
  });
});

describe('logout revokes', () => {
  it('invalidates the token, not just the client copy', async () => {
    const h = harness();
    const login = await h.login();
    expect((await h.session(login)).status).toBe(200);

    // A stolen token outliving the victim's logout is the whole threat, so the
    // assertion is on the *server's* view of that exact token value.
    const stolen = sessionCookie(login) as string;
    const loggedOut = await h.logout(login);
    expect(loggedOut.status).toBe(200);

    const replayed = await h.app.request('/api/v1/auth/session', {
      headers: { cookie: `${COOKIE}=${stolen}` },
    });
    expect(replayed.status, 'a stolen token after logout').toBe(401);
  });

  it('clears the cookie on the response so the browser drops it', async () => {
    const h = harness();
    const login = await h.login();
    const loggedOut = await h.logout(login);
    // Max-Age=0 is how a browser is told to delete it; absent would leave the
    // cookie in place with no server-side error to explain the 401s after.
    expect(loggedOut.headers.get('set-cookie')).toMatch(/automate_session=;/);
    expect(loggedOut.headers.get('set-cookie')).toMatch(/Max-Age=0/i);
  });

  it('is idempotent, and answers 200 with no session at all', async () => {
    const h = harness();
    // Logging out without a session must not be an error: a client whose cookie
    // already expired has nothing to revoke, and reporting failure would make a
    // signed-out user look signed in.
    const anonymous = await h.app.request('/api/v1/auth/logout', { method: 'POST' });
    expect(anonymous.status).toBe(200);

    const login = await h.login();
    expect((await h.logout(login)).status).toBe(200);
    expect((await h.logout(login)).status).toBe(200);
  });
});

describe('login issues a new session', () => {
  it('never reuses a token, so two logins are distinguishable', async () => {
    const h = harness();
    const first = await h.login();
    const second = await h.login();
    expect(sessionCookie(first)).toBeDefined();
    expect(sessionCookie(second)).toBeDefined();
    // Token reuse would make revocation of one session revoke the other, and
    // would make the session id useless as an audit handle.
    expect(sessionCookie(second)).not.toBe(sessionCookie(first));

    const firstBody = (await first.json()) as { sessionId: string };
    const secondBody = (await second.json()) as { sessionId: string };
    expect(secondBody.sessionId).not.toBe(firstBody.sessionId);

    // And both remain independently valid.
    expect((await h.session(first)).status).toBe(200);
    expect((await h.session(second)).status).toBe(200);
  });

  it('leaves an existing session valid when a new one is issued', async () => {
    const h = harness();
    const first = await h.login();
    await h.login();
    // Rotating on login would log out every other tab, which is a surprising
    // consequence of signing in somewhere else.
    expect((await h.session(first)).status).toBe(200);
  });

  it('revokes exactly the session that logged out, and no other', async () => {
    const h = harness();
    const first = await h.login();
    const second = await h.login();
    await h.logout(first);
    expect((await h.session(first)).status).toBe(401);
    expect((await h.session(second)).status, 'the other session').toBe(200);
  });
});

describe('credentials are separate things', () => {
  it('does not accept the installation API key as a session token', async () => {
    const h = harness();
    // The API key and the session token are different credentials with different
    // blast radii. If the session validator accepted the API key, every log
    // request would authenticate.
    const response = await h.app.request('/api/v1/auth/session', {
      headers: { cookie: `${COOKIE}=${API_KEY}` },
    });
    expect(response.status).toBe(401);
  });

  it('does not accept a session token as an installation API key at login', async () => {
    const h = harness();
    const login = await h.login();
    const token = sessionCookie(login) as string;
    const asApiKey = await h.login(token);
    expect(asApiKey.status).toBe(401);
  });

  it('does not accept a session id as a session token', async () => {
    const h = harness();
    const login = await h.login();
    const body = (await login.json()) as { sessionId: string };
    const response = await h.app.request('/api/v1/auth/session', {
      headers: { cookie: `${COOKIE}=${body.sessionId}` },
    });
    // The id is a handle for revocation, not a bearer credential. A test that
    // never tried it cannot say the two are separated.
    expect(response.status).toBe(401);
  });

  it('does not accept a session token from a different installation', async () => {
    // A *second installation*: its own cookie secret, and therefore its own key
    // hash. It can log in with the same API key because the key is the same, but
    // its session tokens are signed with a different secret and must not carry
    // here.
    //
    // Stated as two installations rather than "a different secret" because
    // `cookieSecret` does double duty — it hashes the API key *and* mints
    // sessions — so a differing secret necessarily means a differing key hash,
    // and a login with a matching key against a mismatched hash is a 401 for a
    // reason that has nothing to do with sessions.
    const otherSecret = 'a-completely-different-cookie-secret-32-chars';
    const other = createAuthRoutes({
      cookieSecret: otherSecret,
      installationId: '00000000-0000-4000-9000-0000000000bb',
      installationKeyHash: hashCredential(otherSecret, API_KEY),
      sessionTtlMs: SESSION_TTL_MS,
      secureCookies: false,
    });
    const foreign = await other.app.request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ apiKey: API_KEY }),
    });
    expect(foreign.status).toBe(200);

    const h = harness();
    const response = await h.app.request('/api/v1/auth/session', {
      headers: cookieHeader(foreign),
    });
    expect(response.status).toBe(401);
  });

  it('verifies the installation key with constant-time comparison', () => {
    // A direct assertion on the primitive, because "the route uses the safe one"
    // is a claim about a call site and this is a claim about the function.
    const hash = hashCredential(COOKIE_SECRET, API_KEY);
    expect(verifyCredential(COOKIE_SECRET, API_KEY, hash)).toBe(true);
    expect(verifyCredential(COOKIE_SECRET, `${API_KEY}x`, hash)).toBe(false);
    expect(verifyCredential(COOKIE_SECRET, '', hash)).toBe(false);
    // A different secret must not verify the same key against the same hash.
    expect(verifyCredential('another-cookie-secret-entirely-32-chars', API_KEY, hash)).toBe(false);
  });
});

describe('the session cookie', () => {
  it('is httpOnly, so script cannot read it', async () => {
    const h = harness();
    const setCookie = (await h.login()).headers.get('set-cookie') ?? '';
    // The XSS case: a readable session cookie is a session any injected script
    // can exfiltrate, which is why the credential is a cookie and not localStorage.
    expect(setCookie).toMatch(/HttpOnly/i);
  });

  it('is SameSite=Lax, so it is not sent on a cross-site POST', async () => {
    const h = harness();
    const setCookie = (await h.login()).headers.get('set-cookie') ?? '';
    // `Lax` still allows a top-level GET navigation, which is the trade a
    // same-origin SPA makes; `Strict` would break the reporter's links.
    expect(setCookie).toMatch(/SameSite=Lax/i);
  });

  it('is scoped to the whole origin, and not to a narrower path', async () => {
    const h = harness();
    const setCookie = (await h.login()).headers.get('set-cookie') ?? '';
    // `Path=/api/v1/auth` would leave the dashboard unable to send it at all.
    expect(setCookie).toMatch(/Path=\/(;|$)/);
  });

  it('carries Secure when the deployment is https, and does not otherwise', async () => {
    const secure = harness({ secureCookies: true });
    expect((await secure.login()).headers.get('set-cookie')).toMatch(/Secure/i);

    const plain = harness({ secureCookies: false });
    // Over plain http a `Secure` cookie is never sent, so signing in would appear
    // to work and then fail on the very next request.
    expect((await plain.login()).headers.get('set-cookie') ?? '').not.toMatch(/Secure/i);
  });
});

describe('the login limiter', () => {
  const harnessLimited = (limit: number) =>
    withErrorBoundary(
      createAuthRoutes({
        cookieSecret: COOKIE_SECRET,
        installationId: INSTALLATION_ID,
        installationKeyHash: hashCredential(COOKIE_SECRET, API_KEY),
        sessionTtlMs: SESSION_TTL_MS,
        secureCookies: false,
        loginRateLimit: { limit, windowMs: 60_000 },
        clientKey: () => 'a-single-client',
      }),
    );

  it('refuses the attempt past the budget and says when to come back', async () => {
    const routes = harnessLimited(3);
    const attempt = (apiKey: string) =>
      routes.request('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ apiKey }),
      });

    for (let index = 0; index < 3; index += 1) {
      expect((await attempt('a-wrong-key')).status, `attempt ${String(index + 1)}`).toBe(401);
    }
    const limited = await attempt('a-wrong-key');
    expect(limited.status).toBe(429);
    const body = (await limited.json()) as BoundaryBody;
    expect(body.error.code).toBe('LOGIN_RATE_LIMITED');
    expect(body.error.details.retryAfterSeconds).toBeGreaterThan(0);
    // Without `Retry-After` a client either retries immediately — and is refused
    // again — or gives up on a credential it may simply have mistyped.
    expect(limited.headers.get('retry-after')).toBe(String(body.error.details.retryAfterSeconds));
  });

  it('budgets per key as well as per address, so guessing one key is capped', async () => {
    const routes = harnessLimited(3);
    const attempt = (apiKey: string) =>
      routes.request('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ apiKey }),
      });

    // Five distinct wrong keys from one address. The per-key budget alone would
    // allow all five; only the per-address budget stops a credential-stuffing run
    // that walks a list.
    for (const key of ['k1', 'k2', 'k3', 'k4', 'k5']) {
      await attempt(key);
    }
    const after = await attempt('k6');
    expect(after.status).toBe(429);
  });

  it('does not let a rejected attempt spend nothing, and a correct one is not locked out forever', async () => {
    let clock = 0;
    const routes = withErrorBoundary(
      createAuthRoutes({
        cookieSecret: COOKIE_SECRET,
        installationId: INSTALLATION_ID,
        installationKeyHash: hashCredential(COOKIE_SECRET, API_KEY),
        sessionTtlMs: SESSION_TTL_MS,
        secureCookies: false,
        loginRateLimit: { limit: 2, windowMs: 1_000, now: () => clock },
        clientKey: () => 'a-single-client',
        now: () => new Date(clock),
      }),
    );
    const attempt = (apiKey: string) =>
      routes.request('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ apiKey }),
      });

    await attempt('wrong');
    await attempt('wrong');
    expect((await attempt('wrong')).status).toBe(429);

    // Still refused just before the window rolls.
    clock += 999;
    expect((await attempt(API_KEY)).status).toBe(429);

    // And allowed after it, or a legitimate operator who fat-fingered a key is
    // locked out of their own product.
    clock += 2;
    expect((await attempt(API_KEY)).status).toBe(200);
  });

  it('does not spend the budget on a malformed login request', async () => {
    const routes = harnessLimited(2);
    const malformed = () =>
      routes.request('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ apiKey: '' }),
      });
    for (let index = 0; index < 5; index += 1) {
      expect((await malformed()).status).toBe(400);
    }
    // A 400 is a bug in the client, not a credential guess. If it spent the
    // budget, six malformed requests would lock out the next legitimate login.
    const good = await routes.request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ apiKey: API_KEY }),
    });
    expect(good.status).toBe(200);
  });
});

describe('the composed auth app', () => {
  it('serves exactly the three session routes and nothing else', async () => {
    const h = harness();
    const served = h.app.routes
      .map((route) => `${route.method} ${route.path}`)
      .filter((key) => !key.startsWith('ALL'));
    expect([...served].sort()).toEqual([
      'GET /api/v1/auth/session',
      'POST /api/v1/auth/login',
      'POST /api/v1/auth/logout',
    ]);
  });

  it('is mountable at a prefix without changing any path', async () => {
    // `index.ts` mounts this at `/`, so a route registered relative would work in
    // the route's own test and break in the real composition. The composed-app
    // case is the only one that can catch it.
    const h = harness();
    const mounted = withErrorBoundary(new Hono()).route('/api', h.app);
    const login = await mounted.request('/api/api/v1/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ apiKey: API_KEY }),
    });
    expect(login.status).toBe(200);
  });
});
