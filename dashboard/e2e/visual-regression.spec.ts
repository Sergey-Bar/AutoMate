import { test, expect } from '@playwright/test';

const BASE = process.env.DASHBOARD_URL ?? 'http://localhost:5173';
const API = process.env.API_BASE_URL ?? 'http://localhost:4000';

/**
 * Visual Regression Tests — Automate
 * =============================================
 * Uses Playwright's built-in `toHaveScreenshot()` for pixel-level comparison
 * against committed baseline PNGs.
 *
 * BASELINE WORKFLOW
 * -----------------
 * First run (create/refresh baselines):
 *   npx playwright test e2e/visual-regression.spec.ts --update-snapshots
 *
 * Subsequent CI runs (compare against baselines):
 *   npx playwright test e2e/visual-regression.spec.ts
 *
 * Baselines are committed to git alongside the spec file:
 *   e2e/visual-regression.spec.ts-snapshots/<name>-chromium-<platform>.png
 *
 * To update a single snapshot after an intentional UI change:
 *   npx playwright test e2e/visual-regression.spec.ts -t "login page" --update-snapshots
 *
 * CONFIGURATION
 * -------------
 * Global screenshot settings live in playwright.config.ts under `expect.toHaveScreenshot`.
 * Per-call overrides (e.g. `{ maxDiffPixelRatio: 0.02 }`) take precedence.
 *
 * NOTES
 * -----
 * - All CSS animations/transitions are disabled via `addStyleTag` before every screenshot
 *   to prevent flaky diffs caused by in-flight transitions.
 * - The onboarding wizard is suppressed via `localStorage` so it never obscures pages.
 * - Dynamic timestamps and loading spinners are hidden via CSS masks before capture.
 * - Auth tests require the server to be running; a thin `provisionAuth` helper mirrors
 *   the pattern in `auth-flow.spec.ts`.
 */

// ── Shared helpers ────────────────────────────────────────────────────────────

/** Suppress CSS animations and dynamic content that cause flaky diffs. */
async function freezePage(page: import('@playwright/test').Page) {
  // Disable all animations and transitions
  await page.addStyleTag({
    content: [
      '*, *::before, *::after {',
      '  animation-duration: 0s !important;',
      '  animation-delay: 0s !important;',
      '  transition-duration: 0s !important;',
      '  transition-delay: 0s !important;',
      '}',
      // Hide dynamic timestamps to avoid diff noise
      'time, [data-testid="timestamp"], .timestamp { visibility: hidden !important; }',
      // Hide progress bars / indeterminate spinners
      '[role="progressbar"] { visibility: hidden !important; }',
      // Stabilise the WebSocket connection indicator dot (it pulses)
      '[title*="Connection"] svg { visibility: hidden !important; }',
    ].join('\n'),
  });
}

/** Suppress the onboarding wizard via localStorage before any navigation. */
async function suppressOnboarding(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    localStorage.setItem(
      'mc-onboarding',
      JSON.stringify({ state: { hasCompletedOnboarding: true }, version: 0 }),
    );
  });
}

/**
 * Provision a fresh API key and enable auth on the live server.
 * Returns the raw key and a cleanup function to restore the unauthenticated state.
 * Mirrors the helper in `auth-flow.spec.ts`.
 */
async function provisionAuth(
  request: import('@playwright/test').APIRequestContext,
  keyName: string,
) {
  const createKeyRes = await request.post(`${API}/api/auth/keys`, {
    data: { name: keyName },
  });
  expect(createKeyRes.status()).toBe(201);
  const created = (await createKeyRes.json()) as { id: string; key: string };

  const enableAuthRes = await request.put(`${API}/api/auth/enable`, {
    data: { enabled: true },
  });
  expect(enableAuthRes.status()).toBe(200);

  // Wait until the server confirms auth is active
  await expect
    .poll(async () => {
      const res = await request.get(`${API}/api/auth/status`);
      if (res.status() !== 200) return false;
      const body = (await res.json()) as { enabled: boolean; keyCount: number };
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

// ══════════════════════════════════════════════════════════════════════════════
// 1. PRE-AUTH: Login page
//    These tests enable auth on the server so the login page is visible, then
//    restore the unauthenticated state in cleanup.
// ══════════════════════════════════════════════════════════════════════════════
test.describe('Visual Regression — Login page (auth enabled)', () => {
  test('login page', async ({ page, request }) => {
    await suppressOnboarding(page);

    const auth = await provisionAuth(request, `vr-login-${Date.now()}`);
    try {
      // Intercept auth/status so the SPA immediately sees auth as enabled
      // (avoids the race between server state propagation and first React render)
      await page.route('**/api/auth/status', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ enabled: true, authenticated: false, keyCount: 1 }),
        });
      });

      await page.goto(BASE);
      await page.waitForURL(/\/login/, { timeout: 10_000 });
      await page.unrouteAll({ behavior: 'ignoreErrors' });

      await page.waitForLoadState('networkidle');
      await freezePage(page);

      await expect(page).toHaveScreenshot('login.png', {
        maxDiffPixelRatio: 0.01,
        animations: 'disabled',
      });
    } finally {
      await auth.cleanup();
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. POST-AUTH: Dashboard pages (auth disabled — default test setup)
//    global-setup.ts resets auth.json to { enabled: false } before every run,
//    so these tests always see an unauthenticated (open) dashboard.
// ══════════════════════════════════════════════════════════════════════════════
test.describe('Visual Regression — Core pages', () => {
  test.beforeEach(async ({ page }) => {
    await suppressOnboarding(page);
  });

  // ── Dashboard overview ──────────────────────────────────────────────────
  test('dashboard overview page', async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState('networkidle');
    await freezePage(page);

    await expect(page).toHaveScreenshot('dashboard-overview.png', {
      maxDiffPixelRatio: 0.01,
      animations: 'disabled',
    });
  });

  // ── Runs list ───────────────────────────────────────────────────────────
  test('runs list page', async ({ page }) => {
    await page.goto(`${BASE}/runs`);
    await page.waitForLoadState('networkidle');
    await freezePage(page);

    // Wait for either the runs table or the empty state message
    const table = page.locator('table');
    const emptyState = page.getByText(/no runs/i);
    await expect(table.or(emptyState)).toBeVisible({ timeout: 8_000 });

    await expect(page).toHaveScreenshot('runs-list.png', {
      maxDiffPixelRatio: 0.01,
      animations: 'disabled',
    });
  });

  // ── Run detail ──────────────────────────────────────────────────────────
  test('run detail page', async ({ page }) => {
    // Prefer a seeded run ID from global-setup; fall back to the first run from
    // the API, then gracefully capture the empty-state if no runs exist.
    const seededId = process.env.E2E_RUN_ID_0;

    let runId: string | null = seededId ?? null;

    if (!runId) {
      const res = await page.request.get(`${API}/api/runs?limit=1`);
      if (res.ok()) {
        const body = (await res.json()) as { data?: Array<{ id: string }> };
        runId = body.data?.[0]?.id ?? null;
      }
    }

    if (runId) {
      await page.goto(`${BASE}/runs/${runId}`);
      await page.waitForLoadState('networkidle');
      await freezePage(page);

      // Wait for the run detail heading or error state
      const heading = page.locator('h1');
      const notFound = page.getByText(/not found|run not found/i);
      await expect(heading.or(notFound)).toBeVisible({ timeout: 8_000 });
    } else {
      // No runs seeded — capture the runs page showing the empty state instead
      await page.goto(`${BASE}/runs`);
      await page.waitForLoadState('networkidle');
      await freezePage(page);
      await page.getByText(/no runs/i).waitFor({ state: 'visible', timeout: 5_000 });
    }

    await expect(page).toHaveScreenshot('run-detail.png', {
      maxDiffPixelRatio: 0.01,
      animations: 'disabled',
    });
  });

  // ── Test explorer ───────────────────────────────────────────────────────
  test('test explorer page', async ({ page }) => {
    await page.goto(`${BASE}/tests`);
    await page.waitForLoadState('networkidle');
    await freezePage(page);

    // Wait for the list container to be present
    const listbox = page.locator('[role="listbox"]');
    const emptyState = page.getByText(/no tests|run tests first/i);
    await expect(listbox.or(emptyState)).toBeVisible({ timeout: 8_000 });

    await expect(page).toHaveScreenshot('test-explorer.png', {
      maxDiffPixelRatio: 0.01,
      animations: 'disabled',
    });
  });

  // ── Analytics ───────────────────────────────────────────────────────────
  test('analytics page', async ({ page }) => {
    await page.goto(`${BASE}/analytics`);
    await page.waitForLoadState('networkidle');
    await freezePage(page);

    // Charts may still render asynchronously — wait for heading to settle
    const heading = page.locator('h1');
    await expect(heading).toBeVisible({ timeout: 8_000 });
    // Allow extra time for chart data fetches to complete
    await page.waitForTimeout(1_000);

    await expect(page).toHaveScreenshot('analytics.png', {
      maxDiffPixelRatio: 0.01,
      animations: 'disabled',
    });
  });

  // ── Config ──────────────────────────────────────────────────────────────
  test('config page', async ({ page }) => {
    await page.goto(`${BASE}/config`);
    await page.waitForLoadState('networkidle');
    await freezePage(page);

    await expect(page.getByText('Playwright Config')).toBeVisible({ timeout: 8_000 });

    await expect(page).toHaveScreenshot('config.png', {
      maxDiffPixelRatio: 0.01,
      animations: 'disabled',
    });
  });

  // ── Baselines ───────────────────────────────────────────────────────────
  test('baselines page', async ({ page }) => {
    await page.goto(`${BASE}/baselines`);
    await page.waitForLoadState('networkidle');
    await freezePage(page);

    await expect(page.getByRole('heading', { name: 'Baselines' })).toBeVisible({
      timeout: 8_000,
    });

    await expect(page).toHaveScreenshot('baselines.png', {
      maxDiffPixelRatio: 0.01,
      animations: 'disabled',
    });
  });

  // ── Settings ────────────────────────────────────────────────────────────
  test('settings page', async ({ page }) => {
    await page.goto(`${BASE}/settings`);
    await page.waitForLoadState('networkidle');
    await freezePage(page);

    const heading = page.locator('h1');
    await expect(heading).toBeVisible({ timeout: 8_000 });

    await expect(page).toHaveScreenshot('settings.png', {
      maxDiffPixelRatio: 0.01,
      animations: 'disabled',
    });
  });

  // ── Settings — Integrations tab ─────────────────────────────────────────
  test('settings page — integrations tab', async ({ page }) => {
    await page.goto(`${BASE}/settings?tab=integrations`);
    await page.waitForLoadState('networkidle');
    await freezePage(page);

    await expect(page.getByText('Slack').first()).toBeVisible({ timeout: 8_000 });

    await expect(page).toHaveScreenshot('settings-integrations.png', {
      maxDiffPixelRatio: 0.01,
      animations: 'disabled',
    });
  });

  // ── Settings — AI tab ───────────────────────────────────────────────────
  test('settings page — AI tab', async ({ page }) => {
    await page.goto(`${BASE}/settings?tab=ai`);
    await page.waitForLoadState('networkidle');
    await freezePage(page);

    await expect(page.getByRole('main').getByText('AI Configuration')).toBeVisible({
      timeout: 8_000,
    });

    await expect(page).toHaveScreenshot('settings-ai.png', {
      maxDiffPixelRatio: 0.01,
      animations: 'disabled',
    });
  });

  // ── Codegen launcher ────────────────────────────────────────────────────
  test('codegen launcher page', async ({ page }) => {
    await page.goto(`${BASE}/tools/codegen`);
    await page.waitForLoadState('networkidle');
    await freezePage(page);

    await expect(page.getByRole('heading', { name: 'Codegen' })).toBeVisible({
      timeout: 8_000,
    });

    await expect(page).toHaveScreenshot('codegen.png', {
      maxDiffPixelRatio: 0.01,
      animations: 'disabled',
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. RESPONSIVE SNAPSHOTS — Sidebar collapsed
// ══════════════════════════════════════════════════════════════════════════════
test.describe('Visual Regression — Sidebar states', () => {
  test.beforeEach(async ({ page }) => {
    await suppressOnboarding(page);
  });

  test('dashboard overview — sidebar collapsed', async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState('networkidle');
    await freezePage(page);

    // Collapse the sidebar
    const toggleBtn = page.getByLabel('Toggle sidebar');
    if (await toggleBtn.isVisible()) {
      await toggleBtn.click();
      // Give the sidebar collapse animation a moment to settle even though
      // we've already zeroed transition-duration; the DOM reflow may be async.
      await page.waitForTimeout(200);
    }

    await expect(page).toHaveScreenshot('dashboard-overview-sidebar-collapsed.png', {
      maxDiffPixelRatio: 0.01,
      animations: 'disabled',
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. THEME SNAPSHOTS — Dark mode
// ══════════════════════════════════════════════════════════════════════════════
test.describe('Visual Regression — Dark mode', () => {
  test.use({ colorScheme: 'dark' });

  test.beforeEach(async ({ page }) => {
    await suppressOnboarding(page);
  });

  test('dashboard overview — dark mode', async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState('networkidle');
    await freezePage(page);

    await expect(page).toHaveScreenshot('dashboard-overview-dark.png', {
      maxDiffPixelRatio: 0.01,
      animations: 'disabled',
    });
  });

  test('analytics page — dark mode', async ({ page }) => {
    await page.goto(`${BASE}/analytics`);
    await page.waitForLoadState('networkidle');
    await freezePage(page);

    const heading = page.locator('h1');
    await expect(heading).toBeVisible({ timeout: 8_000 });
    await page.waitForTimeout(1_000);

    await expect(page).toHaveScreenshot('analytics-dark.png', {
      maxDiffPixelRatio: 0.01,
      animations: 'disabled',
    });
  });

  test('settings page — dark mode', async ({ page }) => {
    await page.goto(`${BASE}/settings`);
    await page.waitForLoadState('networkidle');
    await freezePage(page);

    const heading = page.locator('h1');
    await expect(heading).toBeVisible({ timeout: 8_000 });

    await expect(page).toHaveScreenshot('settings-dark.png', {
      maxDiffPixelRatio: 0.01,
      animations: 'disabled',
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 5. MOBILE VIEWPORT SNAPSHOTS (375 × 812)
// ══════════════════════════════════════════════════════════════════════════════
test.describe('Visual Regression — Mobile viewport', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test.beforeEach(async ({ page }) => {
    await suppressOnboarding(page);
  });

  test('dashboard overview — mobile', async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState('networkidle');
    await freezePage(page);

    await expect(page).toHaveScreenshot('dashboard-overview-mobile.png', {
      maxDiffPixelRatio: 0.01,
      animations: 'disabled',
    });
  });

  test('runs list — mobile', async ({ page }) => {
    await page.goto(`${BASE}/runs`);
    await page.waitForLoadState('networkidle');
    await freezePage(page);

    const table = page.locator('table');
    const emptyState = page.getByText(/no runs/i);
    await expect(table.or(emptyState)).toBeVisible({ timeout: 8_000 });

    await expect(page).toHaveScreenshot('runs-list-mobile.png', {
      maxDiffPixelRatio: 0.01,
      animations: 'disabled',
    });
  });
});
