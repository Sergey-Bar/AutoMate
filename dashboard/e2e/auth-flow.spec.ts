import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.DASHBOARD_URL ?? 'http://localhost:5173';
const API = process.env.API_BASE_URL ?? 'http://localhost:4000';

/**
 * Helper: create an API key and enable auth on the server.
 * Returns the key ID, raw API key, and a cleanup function.
 */
async function provisionAuth(request: import('@playwright/test').APIRequestContext, keyName: string) {
  const createKeyRes = await request.post(`${API}/api/auth/keys`, {
    data: { name: keyName },
  });
  expect(createKeyRes.status()).toBe(201);

  const created = (await createKeyRes.json()) as { id: string; key: string };

  const enableAuthRes = await request.put(`${API}/api/auth/enable`, {
    data: { enabled: true },
  });
  expect(enableAuthRes.status()).toBe(200);

  // Poll until the server confirms auth is enabled with at least one key
  await expect
    .poll(async () => {
      const statusRes = await request.get(`${API}/api/auth/status`);
      if (statusRes.status() !== 200) return false;
      const body = (await statusRes.json()) as { enabled: boolean; keyCount: number };
      return body.enabled && body.keyCount >= 1;
    })
    .toBeTruthy();

  return {
    keyId: created.id,
    apiKey: created.key,
    async cleanup() {
      await request.put(`${API}/api/auth/enable`, { data: { enabled: false } });
      await request.delete(`${API}/api/auth/keys/${created.id}`);
    },
  };
}

test('auth end-to-end: provision key, authenticate, and load dashboard', async ({ page, request }) => {
  // Skip onboarding wizard
  await page.addInitScript(
    "localStorage.setItem('mc-onboarding', JSON.stringify({ state: { hasCompletedOnboarding: true }, version: 0 }));",
  );

  const keyName = `e2e-auth-${Date.now()}`;
  const auth = await provisionAuth(request, keyName);

  try {
    // Login via API to get a session cookie
    const loginRes = await request.post(`${API}/api/auth/login`, {
      data: { apiKey: auth.apiKey },
    });
    expect(loginRes.status()).toBe(200);

    // Extract session cookie from API response and inject into the browser context
    const cookies = (await request.storageState()).cookies;
    const sessionCookie = cookies.find((c) => c.name === 'automate_dashboard_session');

    if (sessionCookie) {
      // Inject the session cookie into the browser context
      await page.context().addCookies([
        {
          name: sessionCookie.name,
          value: sessionCookie.value,
          domain: 'localhost',
          path: '/',
          httpOnly: true,
          secure: false,
          sameSite: 'Lax',
        },
      ]);
    } else {
      // If cookie not captured (API request context is separate), authenticate via page
      // Navigate to app — will redirect to login since auth is enabled
      await page.goto(BASE);
      await page.waitForURL(/\/login/, { timeout: 10000 });
      await page.getByLabel(/api key/i).fill(auth.apiKey);
      await page.getByRole('button', { name: /sign in/i }).click();
      await page.waitForURL(/\/$/, { timeout: 10000 });
    }

    // Navigate to dashboard and verify it loaded
    await page.goto(BASE);
    await page.waitForLoadState('domcontentloaded');

    // Wait for either dashboard content or redirect to login (then authenticate)
    const dashboardLink = page.getByRole('link', { name: 'Dashboard' }).first();
    const loginForm = page.getByLabel(/api key/i);

    // If we landed on login, authenticate through the form
    const loginVisible = await loginForm.isVisible({ timeout: 3000 }).catch(() => false);
    if (loginVisible) {
      await loginForm.fill(auth.apiKey);
      await page.getByRole('button', { name: /sign in/i }).click();
      await page.waitForLoadState('domcontentloaded');
    }

    await expect(dashboardLink).toBeVisible({ timeout: 10000 });

    const kpiSection = page.locator('[aria-label="Key metrics"]');
    const emptyState = page.getByText(/no runs yet|trigger your first run/i);
    await expect(kpiSection.or(emptyState)).toBeVisible();
  } finally {
    await auth.cleanup();
  }
});

/* ══════════════════════════════════════════════════════════════════════════════
 * Sprint 6.2 — Login page flow when auth is enabled
 * ════════════════════════════════════════════════════════════════════════════ */
test.describe('Auth login page flow', () => {
  test.beforeEach(async ({ page }) => {
    // Clear any session cookies from previous tests so we always start unauthenticated.
    await page.context().clearCookies();

    // Reset auth state at the filesystem level before each attempt (including retries).
    // API-level reset is unreliable when auth may already be enabled with unknown keys.
    const authJson = path.resolve(
      process.cwd(),
      'apps/server/.automate/auth.json',
    );
    fs.writeFileSync(authJson, JSON.stringify({ keys: [], enabled: false }, null, 2), 'utf-8');

    await page.addInitScript(() => {
      localStorage.setItem('mc-onboarding', JSON.stringify({ state: { hasCompletedOnboarding: true }, version: 0 }));
    });
  });

  test('redirects to login, signs in with API key, then logs out and cleans up', async ({ page, request }) => {
    const keyName = `e2e-login-${Date.now()}`;
    const auth = await provisionAuth(request, keyName);

    try {
      // Intercept the auth status endpoint so the SPA always sees enabled=true
      // on the very first request. Without this, there is a React render race:
      // ProtectedRoute reads window.location.pathname (not reactive router state)
      // and may transiently return null while the Zustand store transitions from
      // loading=true → enabled=true, causing LoginPage to bounce to /.
      await page.route('**/api/auth/status', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ enabled: true, authenticated: false, keyCount: 1 }),
        });
      });

      // Navigate to app root — the intercepted auth/status immediately returns
      // enabled=true, so ProtectedRoute redirects to /login synchronously.
      await page.goto(BASE);
      await page.waitForURL(/\/login/, { timeout: 10000 });

      // Remove the route mock so the actual sign-in flow hits the real server.
      await page.unrouteAll({ behavior: 'ignoreErrors' });

      // Verify login page elements
      const signInHeading = page.getByText(/sign in with your api key/i);
      const signInButton = page.getByRole('button', { name: /sign in/i });

      await expect(signInHeading.or(signInButton)).toBeVisible({ timeout: 10000 });

      // Fill in API key and sign in
      await page.getByLabel(/api key/i).fill(auth.apiKey);
      await signInButton.click();

      // Wait for the redirect to / and full app load
      await page.waitForURL(/\/$/, { timeout: 15000 });
      await page.waitForLoadState('networkidle', { timeout: 15000 });

      // Should redirect to dashboard after successful login
      await expect(page).toHaveURL(/\/$/, { timeout: 10000 });
      // Wait for the dashboard to fully render — check KPI metrics section or any dashboard content
      const kpiSection = page.locator('[aria-label="Key metrics"]');
      const emptyState = page.getByText(/no runs yet|trigger your first run/i);
      const dashboardLink = page.getByRole('link', { name: 'Dashboard' });
      await expect(kpiSection.or(emptyState).or(dashboardLink)).toBeVisible({ timeout: 15000 });

      // Logout via API
      const logoutRes = await request.post(`${API}/api/auth/logout`);
      expect(logoutRes.status()).toBe(200);
    } finally {
      await auth.cleanup();
    }
  });
});
