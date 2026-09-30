import { expect, test, request as factory } from '@playwright/test';
import { API_BASE, WEB_BASE } from '../support/config.js';
import { observedSummary, saveEvidence } from '../support/evidence.js';

/**
 * The install is open.
 *
 * This file **replaces** `unauthenticated-access.spec.ts`, which asserted the
 * opposite: that a protected route answers 401 without a credential, that a revoked
 * session bounces the browser to a login route, and that an artifact URL is refused
 * anonymously. Those were four assertions about a boundary the product does not have
 * — one tenant, one operator, self-hosted, `WORKSPACE_ID` the only tenancy boundary
 * in the system, multi-tenant isolation out of scope for v1.0.0 (ADR-006).
 *
 * The old file also had a defect worth naming, because it is the kind that survives
 * a long time: its "artifact bytes must require a credential" check reused the
 * authenticated `request` fixture, so the API correctly answered 200 and the test read
 * that as the product being public. **A security assertion that passes for the wrong
 * reason is worse than no assertion.**
 *
 * So the checks are inverted rather than deleted. Each one now says what is true:
 * a caller with no credential, no cookie and no key is served, and the boundary that
 * exists is the network.
 */

const EVIDENCE = 'open-access';

test.describe('the install is open', () => {
  test('the dashboard loads with no session and no API key', async ({ page }) => {
    const responses: string[] = [];
    page.on('response', (response) => {
      if (response.url().includes('/api/v1/')) {
        responses.push(`${String(response.status())} ${response.url().replace(WEB_BASE, '')}`);
      }
    });

    // Straight to the command center. No `authenticate`, no sign-in, no cookie jar.
    await page.goto(`${WEB_BASE}/dashboard`);

    await expect(page.getByTestId('dashboard-page')).toBeVisible({ timeout: 15_000 });
    // And no redirect to a login route, because there is no longer one to be sent to.
    await expect(page).toHaveURL(`${WEB_BASE}/dashboard`);

    const refused = responses.filter((line) => line.startsWith('401'));
    expect(
      refused,
      'every API call the dashboard makes must be served; the install has no credential in front of it',
    ).toEqual([]);

    saveEvidence(EVIDENCE, 'dashboard-without-credentials.json', {
      url: page.url(),
      apiResponses: responses,
      summary: observedSummary('responses', { served: responses.length, refused: refused.length }),
    });
  });

  test('there is no sign-in UI anywhere', async ({ page }) => {
    // The property that matters, stated as what a person would see rather than as a
    // status code. There is no `/login` route in the tree, so `/login` renders nothing
    // a person can use — and asserting a 404 would be asserting a property of the
    // host's rewrite rules rather than of the product.
    await page.goto(`${WEB_BASE}/login`);
    await expect(page.getByRole('textbox', { name: 'API Key' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Sign in' })).toHaveCount(0);

    // And the command center, reached with no cookie at all, offers nothing to sign in
    // with — which is the state a reader lands in.
    await page.goto(`${WEB_BASE}/dashboard`);
    await expect(page.getByTestId('dashboard-page')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('a[href*="/login"]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /sign in|log ?in/i })).toHaveCount(0);
  });

  test('an API caller with no credential at all is served', async () => {
    // The contract, stated once, from a context built with no headers at all.
    const context = await factory.newContext({ baseURL: API_BASE, extraHTTPHeaders: {} });
    try {
      const runs = await context.get(`${API_BASE}/api/v1/runs`);
      expect(
        runs.status(),
        'the install is open: a caller with no credential is served, and the boundary is the network',
      ).toBe(200);

      const features = await context.get(`${API_BASE}/api/v1/features`);
      expect(features.status()).toBe(200);
    } finally {
      await context.dispose();
    }
  });

  test('a credential that is presented is not refused for being present', async () => {
    // Backwards-compatible by design: a client holding an old installation key is not
    // broken by the removal, so an existing script or a CI job keeps working.
    const context = await factory.newContext({
      baseURL: API_BASE,
      extraHTTPHeaders: { authorization: 'Bearer e2e-installation-key-32-characters-long' },
    });
    try {
      const runs = await context.get(`${API_BASE}/api/v1/runs`);
      expect(runs.status()).toBe(200);
    } finally {
      await context.dispose();
    }
  });
});
