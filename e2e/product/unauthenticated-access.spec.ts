/**
 * A session that is refused.
 *
 * Two distinct cases, because they fail differently:
 *
 *  - **No credential at all.** Every non-public route must answer 401 rather than
 *    serve the workspace's evidence to an anonymous caller.
 *  - **A credential that is no longer valid.** The browser still holds the cookie.
 *    The server has revoked it. This is what a user hits when their session
 *    expires mid-visit, and it is the case that reaches the client as a 401 on a
 *    poll rather than on navigation — so it is the one where the client has
 *    somewhere to do something.
 *
 * In the second case the client must land on the login route, and it must do so
 * once: the runs list polls every five seconds, so a client that redirects per
 * 401 turns one expiry into a loop.
 */
import { expect, test } from '@playwright/test';
import {
  getRun,
  listRuns,
  uniqueRunId,
  waitForRunPhase,
  postReporterEvent,
} from '../support/api.js';
import { API_AUTH_HEADERS, API_BASE, WEB_BASE } from '../support/config.js';
import { observedSummary, saveEvidence, saveEvidenceText } from '../support/evidence.js';
import {
  authenticate,
  currentSessionCookie,
  expireSession,
  forgetSession,
  signInAndVisit,
} from '../support/session.js';

const PROTECTED_PATHS = [
  '/api/v1/runs',
  '/api/v1/dashboard/analytics/summary',
  '/api/v1/dashboard/quarantine',
  '/api/v1/events',
];

test.describe('unauthenticated access is refused', () => {
  test('every protected route answers 401 without a credential', async ({ request }) => {
    const observed: Record<string, number> = {};
    for (const path of PROTECTED_PATHS) {
      const response = await request.get(`${API_BASE}${path}`, { failOnStatusCode: false });
      observed[path] = response.status();
      expect(response.status(), `${path} must refuse an anonymous caller`).toBe(401);
    }
    // A wrong key is refused too, so "no header" is not the only way to fail.
    const wrongKey = await request.get(`${API_BASE}/api/v1/runs`, {
      headers: { Authorization: 'Bearer not-the-installation-key' },
      failOnStatusCode: false,
    });
    observed['wrong bearer'] = wrongKey.status();
    expect(wrongKey.status()).toBe(401);

    saveEvidence('unauthenticated', 'status-codes.json', observed);
  });

  test('a session revoked mid-visit sends the browser to the login route, once', async ({
    page,
    context,
    request,
  }) => {
    // Something on the dashboard, so there is a poll that can notice.
    const runId = uniqueRunId();
    await postReporterEvent(request, {
      type: 'run:start',
      runId,
      payload: { total: 1, branch: 'main', commitSha: 'expire00001' },
    });
    await waitForRunPhase(request, runId, ['running', 'queued', 'assigned']);

    await authenticate(context, request);
    await signInAndVisit(page, '/dashboard');
    await expect(page.getByTestId(`run-item-${runId}`)).toBeVisible({ timeout: 15_000 });

    const cookie = await currentSessionCookie(context);
    expect(cookie, 'the browser must be holding a session cookie').toBeTruthy();

    // Revoke it server-side. The cookie stays in the browser, so every later
    // request presents a credential the server will refuse.
    await expireSession(request, cookie as NonNullable<typeof cookie>);

    const responsesBefore: number[] = [];
    page.on('response', (response) => {
      if (response.url().includes('/api/v1/runs') && response.status() === 401) {
        responsesBefore.push(response.status());
      }
    });

    // The poll is every five seconds; allow two intervals so a client that
    // redirects on the first 401 is observed, and one that never redirects fails.
    await expect(page).toHaveURL(new RegExp(`${WEB_BASE.replace(/\./g, '\\.')}/login\\?`), {
      timeout: 20_000,
    });

    const loginForm = page.getByTestId('login-page');
    await expect(loginForm).toBeVisible();
    // The return path is carried, so signing back in returns the user to where
    // they were rather than to a bare dashboard.
    const returnParam = new URL(page.url()).searchParams.get('return');
    expect(returnParam, 'the login route must remember where the user was').toBeTruthy();
    expect(returnParam, 'the return path must be a local path, never an absolute URL').toMatch(
      /^\/(?!\/)/,
    );

    // Once, not once per poll. Ten seconds is two poll intervals; a client that
    // redirects on every 401 would have navigated repeatedly in that window, and
    // a client that loops would never settle on the login form at all.
    const navAfter = await page.evaluate(() => performance.getEntriesByType('navigation').length);
    expect(navAfter, 'the expiry must produce a single navigation, not a loop').toBeLessThanOrEqual(
      2,
    );
    expect(
      responsesBefore.length,
      'the client must not retry a 401 it has already handled',
    ).toBeLessThanOrEqual(1);

    // A clean re-authentication still works, so the redirect did not leave the
    // install unusable.
    await signInAndVisit(page, '/dashboard');
    await expect(page.getByTestId('dashboard-page')).toBeVisible();

    saveEvidence('unauthenticated', 'mid-session-expiry.json', {
      runId,
      returnPath: returnParam,
      navigationsObserved: navAfter,
      unauthorizedResponsesObserved: responsesBefore.length,
    });

    saveEvidenceText(
      'unauthenticated',
      'observed-mid-session-expiry.txt',
      observedSummary('Mid-session expiry — observed state', {
        'seeded run id': runId,
        'url after expiry': page.url(),
        'return path offered': String(returnParam),
        'navigations observed': navAfter,
        '401 responses observed': responsesBefore.length,
        'login form visible': String(await loginForm.isVisible()),
      }),
    );
  });

  test('a browser with no cookie is sent to the login route rather than a dashboard', async ({
    page,
    context,
  }) => {
    await forgetSession(context);
    await page.goto(`${WEB_BASE}/dashboard`);

    await expect(page).toHaveURL(/\/login\?/, { timeout: 15_000 });
    await expect(page.getByTestId('login-page')).toBeVisible();
    // The dashboard's own error state must not be what the user sees: an
    // expired session is not a failure to load evidence.
    await expect(page.getByTestId('command-center-error')).toHaveCount(0);
    await expect(page.getByTestId('runs-list-error')).toHaveCount(0);
  });

  test('the evidence endpoints refuse an anonymous caller even when a run exists', async ({
    request,
  }) => {
    // Established with a credential first, so the 401s below cannot be explained
    // by the resources not existing.
    const runId = uniqueRunId();
    await postReporterEvent(request, {
      type: 'run:start',
      runId,
      payload: { total: 1, branch: 'main', commitSha: 'anon000001' },
    });
    await waitForRunPhase(request, runId, ['running', 'queued', 'assigned']);
    const run = await getRun(request, runId);
    expect(run, 'the run must exist before the anonymous reads are refused').toBeTruthy();
    expect((await listRuns(request)).length).toBeGreaterThan(0);

    for (const path of [
      `/api/v1/runs/${runId}`,
      `/api/v1/runs/${runId}/artifacts`,
      `/api/v1/runs/${runId}/events`,
    ]) {
      const response = await request.get(`${API_BASE}${path}`, { failOnStatusCode: false });
      expect(response.status(), `${path} must refuse an anonymous caller`).toBe(401);
    }

    // And the bearer path still works, so the suite is not simply broken.
    const authorised = await request.get(`${API_BASE}/api/v1/runs/${runId}`, {
      headers: API_AUTH_HEADERS,
    });
    expect(authorised.status()).toBe(200);
  });
});
