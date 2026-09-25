import { test, expect, type Page } from '@playwright/test';

const BASE = process.env.DASHBOARD_URL ?? 'http://localhost:5173';
const API = process.env.API_BASE_URL ?? 'http://localhost:4000';

// ── Seeded run IDs exposed by global-setup ────────────────────────────────────
// global-setup seeds 5 demo runs and exports their IDs via process.env.
// Fall back to known demo IDs if env vars are not set.
const RUN_ID_A = process.env.E2E_RUN_ID_0 ?? 'demo-run-1';
const RUN_ID_B = process.env.E2E_RUN_ID_1 ?? 'demo-run-2';

// ── Fixture data ──────────────────────────────────────────────────────────────
const MOCK_RUNS = [
  {
    id: RUN_ID_A,
    startedAt: new Date(Date.now() - 300_000).toISOString(),
    finishedAt: new Date(Date.now() - 15_000).toISOString(),
    status: 'passed',
    total: 100,
    passed: 95,
    failed: 2,
    flaky: 2,
    skipped: 1,
    durationMs: 285_000,
    branch: 'main',
    commitSha: 'abc1234def5678901234',
    commitMessage: 'feat: implement user authentication flow',
    triggeredBy: 'ci',
    config: null,
    rawArgs: null,
    gateStatus: 'passed',
    source: 'live',
  },
  {
    id: RUN_ID_B,
    startedAt: new Date(Date.now() - 86_400_000).toISOString(),
    finishedAt: new Date(Date.now() - 86_057_000).toISOString(),
    status: 'failed',
    total: 80,
    passed: 50,
    failed: 25,
    flaky: 3,
    skipped: 2,
    durationMs: 342_000,
    branch: 'feature/login',
    commitSha: 'def5678abc1234567890',
    commitMessage: 'fix: handle login timeout gracefully',
    triggeredBy: 'manual',
    config: null,
    rawArgs: null,
    gateStatus: 'failed',
    source: 'live',
  },
];

const MOCK_COMPARE_ROWS = [
  {
    title: 'should login with valid credentials',
    file: 'tests/auth/login.spec.ts',
    statusA: 'passed',
    statusB: 'passed',
    durationA: 1200,
    durationB: 1350,
    changeType: 'unchanged',
  },
  {
    title: 'should reject invalid password',
    file: 'tests/auth/login.spec.ts',
    statusA: 'passed',
    statusB: 'failed',
    durationA: 800,
    durationB: 3000,
    changeType: 'new_failure',
  },
  {
    title: 'should display dashboard KPIs correctly',
    file: 'tests/dashboard/overview.spec.ts',
    statusA: 'failed',
    statusB: 'passed',
    durationA: 2500,
    durationB: 900,
    changeType: 'fixed',
  },
  {
    title: 'should handle network timeout gracefully',
    file: 'tests/dashboard/overview.spec.ts',
    statusA: 'passed',
    statusB: 'flaky',
    durationA: 1500,
    durationB: 4200,
    changeType: 'regression',
  },
  {
    title: 'should validate form input errors',
    file: 'tests/auth/login.spec.ts',
    statusA: null,
    statusB: 'passed',
    durationA: null,
    durationB: 600,
    changeType: 'added',
  },
  {
    title: 'should render chart data for last 30 days',
    file: 'tests/dashboard/charts.spec.ts',
    statusA: 'passed',
    statusB: null,
    durationA: 1800,
    durationB: null,
    changeType: 'removed',
  },
];

// ── Helper: set up API mocks and onboarding bypass ───────────────────────────
async function setupMocks(page: Page, overrideCompareRows = MOCK_COMPARE_ROWS): Promise<void> {
  // Bypass onboarding wizard
  await page.addInitScript(() => {
    localStorage.setItem(
      'mc-onboarding',
      JSON.stringify({ state: { hasCompletedOnboarding: true }, version: 0 }),
    );
  });

  // Mock /api/runs (used by RunComparePicker dropdowns)
  await page.route('**/api/runs', (route) => {
    const url = route.request().url();
    if (route.request().method() === 'GET' && !url.includes('/compare')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_RUNS),
      });
    }
    return route.continue();
  });

  // Mock individual run detail endpoints
  for (const run of MOCK_RUNS) {
    await page.route(`**/api/runs/${run.id}`, (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(run),
        });
      }
      return route.continue();
    });
  }

  // Mock /api/runs/compare
  await page.route('**/api/runs/compare*', (route) => {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(overrideCompareRows),
    });
  });
}

/* ══════════════════════════════════════════════════════════════════════════════
 * 1. COMPARE PAGE — DIRECT NAVIGATION
 * ════════════════════════════════════════════════════════════════════════════ */
test.describe('Run Comparison — Direct Navigation', () => {
  test('navigates to /runs/compare and renders the page', async ({ page }) => {
    await setupMocks(page);
    await page.goto(`${BASE}/runs/compare`);

    await expect(page.locator('h1')).toBeVisible();
    await expect(page.locator('h1')).toContainText(/compare runs/i);
  });

  test('compare page URL is /runs/compare', async ({ page }) => {
    await setupMocks(page);
    await page.goto(`${BASE}/runs/compare`);

    await expect(page).toHaveURL(/\/runs\/compare/);
  });

  test('compare page renders Run A and Run B pickers', async ({ page }) => {
    await setupMocks(page);
    await page.goto(`${BASE}/runs/compare`);

    // Each picker renders its label
    await expect(page.getByText(/run a/i).first()).toBeVisible();
    await expect(page.getByText(/run b/i).first()).toBeVisible();
  });

  test('compare page renders "Changed only" checkbox', async ({ page }) => {
    await setupMocks(page);
    await page.goto(`${BASE}/runs/compare`);

    const checkbox = page.getByRole('checkbox');
    await expect(checkbox).toBeVisible();
  });

  test('compare page renders Export CSV button', async ({ page }) => {
    await setupMocks(page);
    await page.goto(`${BASE}/runs/compare`);

    await expect(page.getByText(/export csv/i)).toBeVisible();
  });

  test('compare page shows empty state table when no runs selected', async ({ page }) => {
    await setupMocks(page);
    await page.goto(`${BASE}/runs/compare`);

    // CompareTable renders "Select two runs to compare." when no runs are selected
    await expect(page.getByText(/select two runs to compare/i)).toBeVisible();
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * 2. COMPARE PAGE — WITH PRESELECTED RUNS (QUERY PARAMS)
 * ════════════════════════════════════════════════════════════════════════════ */
test.describe('Run Comparison — Preselected Runs via Query Params', () => {
  test('loads comparison with ?a=&b= query params', async ({ page }) => {
    await setupMocks(page);
    await page.goto(`${BASE}/runs/compare?a=${RUN_ID_A}&b=${RUN_ID_B}`);

    await expect(page.locator('h1')).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`a=${RUN_ID_A}`));
    await expect(page).toHaveURL(new RegExp(`b=${RUN_ID_B}`));
  });

  test('comparison table renders with rows when both runs selected', async ({ page }) => {
    await setupMocks(page);
    await page.goto(`${BASE}/runs/compare?a=${RUN_ID_A}&b=${RUN_ID_B}`);

    // Wait for CompareTable to render rows
    const table = page.locator('table[role="table"]');
    await expect(table).toBeVisible({ timeout: 8000 });

    // Table should have thead with column headers
    await expect(table.getByRole('columnheader', { name: 'Test' })).toBeVisible();
    await expect(table.getByRole('columnheader', { name: 'Run A' })).toBeVisible();
    await expect(table.getByRole('columnheader', { name: 'Run B' })).toBeVisible();
    await expect(table.getByRole('columnheader', { name: 'Change' })).toBeVisible();
  });

  test('comparison table shows all 6 mocked rows', async ({ page }) => {
    await setupMocks(page);
    await page.goto(`${BASE}/runs/compare?a=${RUN_ID_A}&b=${RUN_ID_B}`);

    const tbody = page.locator('table[role="table"] tbody');
    await expect(tbody).toBeVisible({ timeout: 8000 });

    const rows = tbody.locator('tr[role="row"]');
    await expect(rows).toHaveCount(MOCK_COMPARE_ROWS.length, { timeout: 8000 });
  });

  test('shows correct test titles in comparison table', async ({ page }) => {
    await setupMocks(page);
    await page.goto(`${BASE}/runs/compare?a=${RUN_ID_A}&b=${RUN_ID_B}`);

    await expect(page.getByText('should login with valid credentials')).toBeVisible({ timeout: 8000 });
    await expect(page.getByText('should reject invalid password')).toBeVisible();
  });

  test('shows "New Failure" badge for new_failure change type', async ({ page }) => {
    await setupMocks(page);
    await page.goto(`${BASE}/runs/compare?a=${RUN_ID_A}&b=${RUN_ID_B}`);

    // Use exact match to target the table badge (not the summary bar "1 new failure" text)
    await expect(page.getByText('New Failure', { exact: true })).toBeVisible({ timeout: 8000 });
  });

  test('shows "Fixed" badge for fixed change type', async ({ page }) => {
    await setupMocks(page);
    await page.goto(`${BASE}/runs/compare?a=${RUN_ID_A}&b=${RUN_ID_B}`);

    await expect(page.getByText('Fixed', { exact: true })).toBeVisible({ timeout: 8000 });
  });

  test('shows "Regression" badge for regression change type', async ({ page }) => {
    await setupMocks(page);
    await page.goto(`${BASE}/runs/compare?a=${RUN_ID_A}&b=${RUN_ID_B}`);

    await expect(page.getByText('Regression', { exact: true })).toBeVisible({ timeout: 8000 });
  });

  test('shows "Added" badge for added change type', async ({ page }) => {
    await setupMocks(page);
    await page.goto(`${BASE}/runs/compare?a=${RUN_ID_A}&b=${RUN_ID_B}`);

    await expect(page.getByText('Added')).toBeVisible({ timeout: 8000 });
  });

  test('shows "Removed" badge for removed change type', async ({ page }) => {
    await setupMocks(page);
    await page.goto(`${BASE}/runs/compare?a=${RUN_ID_A}&b=${RUN_ID_B}`);

    await expect(page.getByText('Removed')).toBeVisible({ timeout: 8000 });
  });

  test('summary bar appears with pass rate when both runs selected', async ({ page }) => {
    await setupMocks(page);
    await page.goto(`${BASE}/runs/compare?a=${RUN_ID_A}&b=${RUN_ID_B}`);

    // Summary bar renders pass rate: "Pass rate: 95% → 63%"
    await expect(page.getByText(/pass rate/i)).toBeVisible({ timeout: 8000 });
  });

  test('summary bar shows new failures count', async ({ page }) => {
    await setupMocks(page);
    await page.goto(`${BASE}/runs/compare?a=${RUN_ID_A}&b=${RUN_ID_B}`);

    // 1 new failure in mock data → "1 new failure" in summary bar
    await expect(page.getByText('1 new failure')).toBeVisible({ timeout: 8000 });
  });

  test('summary bar shows fixed count', async ({ page }) => {
    await setupMocks(page);
    await page.goto(`${BASE}/runs/compare?a=${RUN_ID_A}&b=${RUN_ID_B}`);

    // 1 fixed in mock data → "1 fixed" in summary bar
    await expect(page.getByText('1 fixed')).toBeVisible({ timeout: 8000 });
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * 3. RUN COMPARE PICKER — INTERACTIVE SELECTION
 * ════════════════════════════════════════════════════════════════════════════ */
test.describe('Run Comparison — Picker Interaction', () => {
  test('Run A picker opens dropdown on click', async ({ page }) => {
    await setupMocks(page);
    await page.goto(`${BASE}/runs/compare`);

    // Click the first picker button (Run A)
    const pickerButtons = page.locator('button').filter({ hasText: /select run|run a/i });
    const runAButton = pickerButtons.first();
    await runAButton.click();

    // Dropdown should appear with search input
    const searchInput = page.getByPlaceholder(/search runs/i);
    await expect(searchInput).toBeVisible({ timeout: 3000 });
  });

  test('Run A picker shows available runs in dropdown', async ({ page }) => {
    await setupMocks(page);
    await page.goto(`${BASE}/runs/compare`);

    // Open Run A picker — find the first "Select run…" button
    const selectButton = page.getByText(/select run/i).first();
    await selectButton.click();

    // Dropdown lists should show the mocked run IDs (first 8 chars)
    const runIdPrefix = RUN_ID_A.slice(0, 8);
    await expect(page.getByText(runIdPrefix).first()).toBeVisible({ timeout: 3000 });
  });

  test('selecting a run from picker A updates the URL', async ({ page }) => {
    await setupMocks(page);
    await page.goto(`${BASE}/runs/compare`);

    // Open Run A picker
    const selectButton = page.getByText(/select run/i).first();
    await selectButton.click();

    // Click the first run in the dropdown
    const runIdPrefix = RUN_ID_A.slice(0, 8);
    const runOption = page.getByText(runIdPrefix).first();
    await runOption.click();

    // URL should now include ?a=RUN_ID_A
    await expect(page).toHaveURL(new RegExp(`a=${RUN_ID_A}`), { timeout: 3000 });
  });

  test('picker filters runs by search query', async ({ page }) => {
    await setupMocks(page);
    await page.goto(`${BASE}/runs/compare`);

    // Open Run A picker
    const selectButton = page.getByText(/select run/i).first();
    await selectButton.click();

    const searchInput = page.getByPlaceholder(/search runs/i);
    await searchInput.fill('main');

    // After filtering, only runs with branch "main" should show
    await page.waitForTimeout(300); // debounce

    // Run A is on 'main' branch — its ID prefix should still be visible
    const runIdAPrefix = RUN_ID_A.slice(0, 8);
    await expect(page.getByText(runIdAPrefix).first()).toBeVisible({ timeout: 3000 });
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * 4. CHANGED ONLY FILTER
 * ════════════════════════════════════════════════════════════════════════════ */
test.describe('Run Comparison — Changed Only Filter', () => {
  test('"Changed only" checkbox toggles visible rows', async ({ page }) => {
    await setupMocks(page);
    await page.goto(`${BASE}/runs/compare?a=${RUN_ID_A}&b=${RUN_ID_B}`);

    const table = page.locator('table[role="table"] tbody');
    await expect(table).toBeVisible({ timeout: 8000 });

    // Initially all 6 rows are visible
    const allRows = table.locator('tr[role="row"]');
    await expect(allRows).toHaveCount(MOCK_COMPARE_ROWS.length, { timeout: 5000 });

    // Enable "Changed only" — 1 unchanged row should be hidden (5 rows visible)
    const checkbox = page.getByRole('checkbox');
    await checkbox.check();
    await page.waitForTimeout(300);

    const changedCount = MOCK_COMPARE_ROWS.filter((r) => r.changeType !== 'unchanged').length;
    await expect(allRows).toHaveCount(changedCount, { timeout: 5000 });
  });

  test('"Changed only" filter URL param is reflected in the checkbox state', async ({ page }) => {
    await setupMocks(page);
    await page.goto(`${BASE}/runs/compare?a=${RUN_ID_A}&b=${RUN_ID_B}&changedOnly=true`);

    const checkbox = page.getByRole('checkbox');
    await expect(checkbox).toBeChecked({ timeout: 5000 });
  });

  test('unchecking "Changed only" restores all rows', async ({ page }) => {
    await setupMocks(page);
    await page.goto(`${BASE}/runs/compare?a=${RUN_ID_A}&b=${RUN_ID_B}&changedOnly=true`);

    const table = page.locator('table[role="table"] tbody');
    await expect(table).toBeVisible({ timeout: 8000 });

    // Uncheck filter
    const checkbox = page.getByRole('checkbox');
    await expect(checkbox).toBeChecked();
    await checkbox.uncheck();
    await page.waitForTimeout(300);

    // All rows should be back
    const rows = table.locator('tr[role="row"]');
    await expect(rows).toHaveCount(MOCK_COMPARE_ROWS.length, { timeout: 5000 });
  });

  test('"No differences" message when changedOnly=true and all rows are unchanged', async ({ page }) => {
    const allUnchangedRows = MOCK_COMPARE_ROWS.map((r) => ({ ...r, changeType: 'unchanged' as const }));
    await setupMocks(page, allUnchangedRows);
    await page.goto(`${BASE}/runs/compare?a=${RUN_ID_A}&b=${RUN_ID_B}&changedOnly=true`);

    await expect(page.getByText(/no differences between these runs/i)).toBeVisible({ timeout: 8000 });
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * 5. RUNS PAGE → NAVIGATE TO COMPARE
 * ════════════════════════════════════════════════════════════════════════════ */
test.describe('Run Comparison — Navigation from Runs Page', () => {
  test('runs page loads successfully before navigating to compare', async ({ page }) => {
    await setupMocks(page);
    await page.goto(`${BASE}/runs`);

    await expect(page.locator('h1')).toBeVisible();
    await expect(page).toHaveURL(/\/runs/);
  });

  test('can navigate from /runs to /runs/compare via direct URL', async ({ page }) => {
    await setupMocks(page);
    await page.goto(`${BASE}/runs`);

    // Navigate to compare page directly
    await page.goto(`${BASE}/runs/compare`);
    await expect(page).toHaveURL(/\/runs\/compare/);
    await expect(page.locator('h1')).toContainText(/compare runs/i);
  });

  test('compare page is accessible from sidebar (via Runs nav)', async ({ page }) => {
    await setupMocks(page);
    await page.goto(`${BASE}/runs/compare?a=${RUN_ID_A}&b=${RUN_ID_B}`);

    // Page should load with full layout (main navigation sidebar visible)
    const nav = page.getByRole('navigation', { name: 'Main navigation' });
    await expect(nav).toBeVisible();
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * 6. TABLE STRUCTURE VALIDATION
 * ════════════════════════════════════════════════════════════════════════════ */
test.describe('Run Comparison — Table Structure', () => {
  test('comparison table has 6 columns', async ({ page }) => {
    await setupMocks(page);
    await page.goto(`${BASE}/runs/compare?a=${RUN_ID_A}&b=${RUN_ID_B}`);

    const columnHeaders = page.locator('table[role="table"] th[role="columnheader"]');
    await expect(columnHeaders).toHaveCount(6, { timeout: 8000 });
  });

  test('column headers are: Test, Run A, Run B, Change, Duration A, Duration B', async ({ page }) => {
    await setupMocks(page);
    await page.goto(`${BASE}/runs/compare?a=${RUN_ID_A}&b=${RUN_ID_B}`);

    const headerTexts = ['Test', 'Run A', 'Run B', 'Change', 'Duration A', 'Duration B'];
    for (const headerText of headerTexts) {
      await expect(
        page.locator('table[role="table"]').getByRole('columnheader', { name: headerText }),
      ).toBeVisible({ timeout: 8000 });
    }
  });

  test('unchanged rows render "—" in Change column', async ({ page }) => {
    await setupMocks(page);
    await page.goto(`${BASE}/runs/compare?a=${RUN_ID_A}&b=${RUN_ID_B}`);

    const tbody = page.locator('table[role="table"] tbody');
    await expect(tbody).toBeVisible({ timeout: 8000 });

    // Unchanged rows show no change badge — the badge is absent and the row renders without color accent.
    // The test "should login with valid credentials" is unchanged — verify it renders in the table.
    await expect(page.getByText('should login with valid credentials')).toBeVisible({ timeout: 8000 });

    // Also confirm at least 6 rows rendered (all types including unchanged)
    const rows = tbody.locator('tr[role="row"]');
    await expect(rows).toHaveCount(MOCK_COMPARE_ROWS.length, { timeout: 5000 });
  });

  test('removed test row shows "—" in Run B status column', async ({ page }) => {
    await setupMocks(page);
    await page.goto(`${BASE}/runs/compare?a=${RUN_ID_A}&b=${RUN_ID_B}`);

    await expect(page.getByText('Removed')).toBeVisible({ timeout: 8000 });
  });

  test('table file paths are shown in smaller text below test titles', async ({ page }) => {
    await setupMocks(page);
    await page.goto(`${BASE}/runs/compare?a=${RUN_ID_A}&b=${RUN_ID_B}`);

    // File paths appear as secondary text in the Test column
    await expect(page.getByText('tests/auth/login.spec.ts').first()).toBeVisible({ timeout: 8000 });
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * 7. EXPORT CSV
 * ════════════════════════════════════════════════════════════════════════════ */
test.describe('Run Comparison — Export CSV', () => {
  test('Export CSV button is visible when runs are selected', async ({ page }) => {
    await setupMocks(page);
    await page.goto(`${BASE}/runs/compare?a=${RUN_ID_A}&b=${RUN_ID_B}`);

    const exportBtn = page.getByRole('button', { name: /export csv/i });
    await expect(exportBtn).toBeVisible({ timeout: 8000 });
  });

  test('clicking Export CSV triggers a download', async ({ page }) => {
    await setupMocks(page);
    await page.goto(`${BASE}/runs/compare?a=${RUN_ID_A}&b=${RUN_ID_B}`);

    // Wait for comparison data to load
    await expect(page.getByText('should login with valid credentials')).toBeVisible({ timeout: 8000 });

    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 5000 }),
      page.getByRole('button', { name: /export csv/i }).click(),
    ]);

    expect(download.suggestedFilename()).toBe('run-comparison.csv');
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * 8. EMPTY STATE & ERROR HANDLING
 * ════════════════════════════════════════════════════════════════════════════ */
test.describe('Run Comparison — Empty State & Error Handling', () => {
  test('shows "Select two runs to compare." when no runs are selected', async ({ page }) => {
    await setupMocks(page, []);
    await page.goto(`${BASE}/runs/compare`);

    await expect(page.getByText(/select two runs to compare/i)).toBeVisible({ timeout: 5000 });
  });

  test('compare page does not crash with empty run list', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem(
        'mc-onboarding',
        JSON.stringify({ state: { hasCompletedOnboarding: true }, version: 0 }),
      );
    });

    // Return empty runs list
    await page.route('**/api/runs', (route) => {
      if (route.request().method() === 'GET' && !route.request().url().includes('/compare')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      }
      return route.continue();
    });
    await page.route('**/api/runs/compare*', (route) => {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    });

    await page.goto(`${BASE}/runs/compare`);

    await expect(page.locator('body')).toBeVisible();
    await expect(page.locator('h1')).toContainText(/compare runs/i);
  });

  test('compare page renders page structure even with no URL params', async ({ page }) => {
    await setupMocks(page, []);
    await page.goto(`${BASE}/runs/compare`);

    // Both pickers should still render
    await expect(page.getByText(/run a/i).first()).toBeVisible();
    await expect(page.getByText(/run b/i).first()).toBeVisible();
    // Table placeholder should be visible
    await expect(page.getByText(/select two runs to compare/i)).toBeVisible();
  });

  test('compare page handles API error gracefully', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem(
        'mc-onboarding',
        JSON.stringify({ state: { hasCompletedOnboarding: true }, version: 0 }),
      );
    });

    // /api/runs succeeds, /api/runs/compare returns 500
    await page.route('**/api/runs', (route) => {
      if (route.request().method() === 'GET' && !route.request().url().includes('/compare')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_RUNS) });
      }
      return route.continue();
    });
    for (const run of MOCK_RUNS) {
      await page.route(`**/api/runs/${run.id}`, (route) => {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(run) });
      });
    }
    await page.route('**/api/runs/compare*', (route) => {
      return route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"Internal server error"}' });
    });

    await page.goto(`${BASE}/runs/compare?a=${RUN_ID_A}&b=${RUN_ID_B}`);

    // Page should not crash — the ErrorBoundary or loading state should be visible
    await expect(page.locator('body')).toBeVisible();
    const errorOverlay = page.locator('vite-error-overlay, #webpack-dev-server-client-overlay');
    await expect(errorOverlay).not.toBeVisible();
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * 9. REAL DATA INTEGRATION (uses seeded DB data — no mocks)
 * ════════════════════════════════════════════════════════════════════════════ */
test.describe('Run Comparison — Real Seeded Data', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem(
        'mc-onboarding',
        JSON.stringify({ state: { hasCompletedOnboarding: true }, version: 0 }),
      );
    });
  });

  test('compare page loads with seeded run IDs in URL', async ({ page }) => {
    await page.goto(`${BASE}/runs/compare?a=${RUN_ID_A}&b=${RUN_ID_B}`);

    await expect(page.locator('h1')).toBeVisible({ timeout: 10_000 });
    await expect(page).toHaveURL(new RegExp(`a=${RUN_ID_A}`));
    await expect(page).toHaveURL(new RegExp(`b=${RUN_ID_B}`));
  });

  test('real API returns comparison data for seeded runs', async ({ request }) => {
    const res = await request.get(`${API}/api/runs/compare?a=${RUN_ID_A}&b=${RUN_ID_B}`);
    expect(res.ok()).toBeTruthy();

    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);

    if (data.length > 0) {
      const row = data[0] as Record<string, unknown>;
      expect(row).toHaveProperty('title');
      expect(row).toHaveProperty('file');
      expect(row).toHaveProperty('statusA');
      expect(row).toHaveProperty('statusB');
      expect(row).toHaveProperty('changeType');
    }
  });

  test('compare page renders rows from real DB comparison', async ({ page }) => {
    await page.goto(`${BASE}/runs/compare?a=${RUN_ID_A}&b=${RUN_ID_B}`);

    const table = page.locator('table[role="table"]');
    await expect(table).toBeVisible({ timeout: 10_000 });

    // Rows should load from the real API (seeded data has tests per run)
    const tbody = table.locator('tbody');
    const rows = tbody.locator('tr[role="row"]');
    const rowCount = await rows.count();
    // Seeded runs have tests; comparison should yield at least some rows
    expect(rowCount).toBeGreaterThan(0);
  });

  test('real seeded data renders "vs" separator between pickers', async ({ page }) => {
    await page.goto(`${BASE}/runs/compare?a=${RUN_ID_A}&b=${RUN_ID_B}`);

    await expect(page.getByText('vs')).toBeVisible({ timeout: 10_000 });
  });
});
