/**
 * Signing the browser in, and signing it out from under the page.
 *
 * Two things this has to get right:
 *
 * 1. **One login per worker, not one per test.** `POST /api/v1/auth/login` is
 *    rate limited to 5 attempts per address per minute — deliberately, because
 *    login is the one unauthenticated endpoint. A suite that logs in once per
 *    browser test exhausts that budget halfway through and then fails on
 *    `429 Too many login attempts`, which looks like a product bug and is not
 *    one. The session cookie is minted once and injected into each context.
 *
 * 2. **Expiry that is real.** A test that deletes the cookie proves the client
 *    handles a request with no credential. A test that revokes the session
 *    server-side proves the harder and more likely case: the browser still
 *    presents a cookie, and the server refuses it. That is what {@link expireSession}
 *    does, using a second request context that holds the same session.
 */
import {
  expect,
  request as playwrightRequest,
  type APIRequestContext,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import { API_BASE, INSTALLATION_KEY, SESSION_COOKIE, WEB_BASE } from './config.js';

interface SessionCookie {
  name: string;
  value: string;
}

let minted: SessionCookie | null = null;

function parseSetCookie(header: string | undefined): SessionCookie {
  expect(header, 'a successful login must set a session cookie').toBeTruthy();
  const [pair] = (header as string).split(';');
  const [name, ...rest] = (pair as string).split('=');
  return { name: (name as string).trim(), value: rest.join('=').trim() };
}

/**
 * Put a valid session cookie into `context`, minting it on first use.
 *
 * Returns the cookie so a spec can revoke exactly this session.
 */
/**
 * Assert that a URL is **not public**, using a context that carries no credential.
 *
 * One function, so an authenticated context cannot be passed in by mistake — which is
 * not hypothetical. `failed-run-evidence.spec.ts` reused the `request` fixture for its
 * "artifact bytes must require a credential" check; that fixture carries
 * `API_AUTH_HEADERS` as default headers, so the product correctly answered 200 to an
 * authenticated caller and the test read it as the product publishing its evidence.
 * **A security assertion that passes for the wrong reason is worse than no assertion**,
 * because it is a green check that will never notice the day it matters.
 *
 * The context is built from Playwright's `request` **factory**, because the `request`
 * fixture is an `APIRequestContext` and `newContext` lives on the `APIRequest` that made
 * it. `extraHTTPHeaders: {}` is explicit rather than omitted so the intent is visible
 * here rather than at each call site.
 *
 * @param url a route that must refuse an anonymous caller
 * @returns the refusal status, so a caller can assert something further about it
 */
export async function expectRefusedAnonymous(url: string): Promise<number> {
  const context = await playwrightRequest.newContext({ baseURL: API_BASE, extraHTTPHeaders: {} });
  try {
    const response = await context.get(url);
    expect(
      response.status(),
      `${url} must refuse an anonymous caller; a 200 here means the assertion was made with a ` +
        'credential, which makes it vacuous rather than wrong',
    ).toBe(401);
    return response.status();
  } finally {
    await context.dispose();
  }
}

export async function authenticate(
  context: BrowserContext,
  request: APIRequestContext,
): Promise<SessionCookie> {
  if (minted === null) {
    minted = parseSetCookie(await mintSession(request));
    expect(minted.name, 'the session cookie name is part of the contract').toBe(SESSION_COOKIE);
  }
  await context.addCookies([
    { name: minted.name, value: minted.value, url: WEB_BASE, httpOnly: true, sameSite: 'Lax' },
  ]);
  return minted;
}

/**
 * Exchange the installation key for a session, waiting out the login rate limit
 * once if it is hit.
 *
 * The limit is 5 attempts per address per 60 seconds, and it is real on purpose —
 * login is the one unauthenticated endpoint. One mint per worker process normally
 * keeps the suite well inside it, but a developer who runs the suite twice inside
 * a minute spends the budget of the first run, and a 429 in the second run is an
 * artefact of how fast it was started, not a product failure. One bounded retry
 * turns that into a slower pass; it never turns a real refusal into a pass,
 * because the wait is bounded and the second attempt is still asserted.
 */
async function mintSession(request: APIRequestContext): Promise<string | undefined> {
  const attempt = async (): Promise<{ status: number; setCookie?: string; body: string }> => {
    const response = await request.post(`${API_BASE}/api/v1/auth/login`, {
      data: { apiKey: INSTALLATION_KEY },
      headers: { 'Content-Type': 'application/json' },
      failOnStatusCode: false,
    });
    return {
      status: response.status(),
      setCookie: response.headers()['set-cookie'],
      body: await response.text(),
    };
  };

  const first = await attempt();
  if (first.status === 200) return first.setCookie;

  if (first.status === 429) {
    const retryAfter = (() => {
      try {
        return Number((JSON.parse(first.body) as { retryAfterSeconds?: number }).retryAfterSeconds);
      } catch {
        return Number.NaN;
      }
    })();
    const waitMs = Number.isFinite(retryAfter) ? Math.min(retryAfter, 60) * 1000 + 500 : 5_000;
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    const second = await attempt();
    expect(
      second.status,
      `POST /api/v1/auth/login after waiting out the rate limit -> ${second.status} ${second.body}`,
    ).toBe(200);
    return second.setCookie;
  }

  expect(first.status, `POST /api/v1/auth/login -> ${first.status} ${first.body}`).toBe(200);
  return first.setCookie;
}

/** The session cookie the browser is currently presenting, if any. */
export async function currentSessionCookie(
  context: BrowserContext,
): Promise<SessionCookie | undefined> {
  const cookies = await context.cookies(WEB_BASE);
  return cookies.find((cookie) => cookie.name === SESSION_COOKIE) as SessionCookie | undefined;
}

/**
 * Revoke the session the browser is holding, from a separate request context.
 *
 * The cookie stays in the browser. Every subsequent request presents a credential
 * that is no longer valid, which is the state an expired session actually leaves
 * behind — and the one a client that only checks "is there a cookie?" will get
 * wrong.
 */
export async function expireSession(
  request: APIRequestContext,
  cookie: SessionCookie,
): Promise<void> {
  const response = await request.post(`${API_BASE}/api/v1/auth/logout`, {
    headers: { Cookie: `${cookie.name}=${cookie.value}` },
  });
  expect(response.status(), `POST /api/v1/auth/logout -> ${response.status()}`).toBe(200);
}

/** Drop every cookie, so the next request presents no credential at all. */
export async function forgetSession(context: BrowserContext): Promise<void> {
  await context.clearCookies();
}

/**
 * Land on a page with a working session.
 *
 * `AuthGuard` renders nothing but a "Loading" status while it checks
 * `/api/v1/auth/session`, so a spec that asserted immediately after `goto` would
 * be asserting about that status rather than the page.
 */
export async function signInAndVisit(page: Page, path: string): Promise<void> {
  await page.goto(`${WEB_BASE}${path}`);
  await expect(page.getByTestId('auth-loading')).toBeHidden();
}
