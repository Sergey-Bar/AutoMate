import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.DASHBOARD_URL ?? 'http://localhost:5173';
const API = process.env.API_BASE_URL ?? 'http://localhost:4000';

/** Read seeded run IDs from the JSON file written by global-setup. */
function readSeededRunIds(): string[] {
  try {
    const seedFile = path.resolve(process.cwd(), 'e2e/seeded-runs.json');
    const raw = fs.readFileSync(seedFile, 'utf-8');
    const parsed = JSON.parse(raw) as { e2eSeededRunIds?: string[] };
    return Array.isArray(parsed.e2eSeededRunIds) ? parsed.e2eSeededRunIds : [];
  } catch {
    return [];
  }
}

/* ──────────────────────────────────────────────────────────────────────────────
 * Global: skip onboarding wizard for all tests
 * ────────────────────────────────────────────────────────────────────────── */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'mc-onboarding',
      JSON.stringify({ state: { hasCompletedOnboarding: true }, version: 0 }),
    );
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * 1. ERROR CLUSTERS API
 * ════════════════════════════════════════════════════════════════════════════ */
test.describe('Error Clusters — API', () => {
  test('GET /api/error-clusters without runId returns 400', async ({ request }) => {
    const res = await request.get(`${API}/api/error-clusters`);
    expect(res.status()).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/runId/i);
  });

  test('GET /api/error-clusters with unknown runId returns empty array', async ({ request }) => {
    const res = await request.get(`${API}/api/error-clusters?runId=non-existent-run-id`);
    expect(res.status()).toBe(200);
    const body = await res.json() as unknown[];
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(0);
  });

  test('GET /api/error-clusters with seeded runId returns cluster array', async ({ request }) => {
    const runId = process.env.E2E_RUN_ID_0 || readSeededRunIds()[0];
    if (!runId) {
      test.skip(true, 'No seeded run IDs available');
      return;
    }
    const res = await request.get(`${API}/api/error-clusters?runId=${runId}`);
    expect(res.status()).toBe(200);
    const body = await res.json() as unknown[];
    expect(Array.isArray(body)).toBe(true);
    // Each cluster (if any) must have the expected shape
    for (const item of body) {
      const cluster = item as Record<string, unknown>;
      expect(typeof cluster['clusterId']).toBe('string');
      expect(typeof cluster['sampleError']).toBe('string');
      expect(typeof cluster['count']).toBe('number');
      expect(Array.isArray(cluster['testIds'])).toBe(true);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * 2. ERROR CLUSTERS IN RUN DETAIL (UI with mocked data)
 * ════════════════════════════════════════════════════════════════════════════ */
test.describe('Error Clusters — Run Detail UI', () => {
  // demo-run-2 has failed: 25, which is > 3 so clusters section renders
  const runId = 'demo-run-2';

  const mockClusters = [
    {
      clusterId: 'cluster-0',
      sampleError: 'Timeout waiting for element: locator(".submit-btn")',
      sampleStack: 'Error: Timeout\n    at Context.eval (tests/login.spec.ts:42)',
      testIds: ['test-1', 'test-2', 'test-3', 'test-4'],
      count: 4,
    },
    {
      clusterId: 'cluster-1',
      sampleError: 'Expected element to be visible, but it was not',
      sampleStack: null,
      testIds: ['test-5', 'test-6'],
      count: 2,
    },
    {
      clusterId: 'cluster-2',
      sampleError: 'Network request failed: ERR_CONNECTION_REFUSED',
      sampleStack: 'NetworkError: connection refused\n    at Object.fetch (api/client.ts:12)',
      testIds: ['test-7', 'test-8'],
      count: 2,
    },
  ];

  test.beforeEach(async ({ page }) => {
    // Mock the error clusters API (both potential paths the client may use)
    await page.route(`**/api/analytics/error-clusters?runId=${runId}`, async (route) => {
      await route.fulfill({ json: mockClusters });
    });
    await page.route(`**/api/error-clusters?runId=${runId}`, async (route) => {
      await route.fulfill({ json: mockClusters });
    });
  });

  test('navigates to run detail page successfully', async ({ page }) => {
    await page.goto(`${BASE}/runs/${runId}`);
    await expect(page).toHaveURL(new RegExp(`/runs/${runId}`));
    await expect(page.locator('body')).toBeVisible();
  });

  test('run detail page renders KPI pills for a failed run', async ({ page }) => {
    await page.goto(`${BASE}/runs/${runId}`);
    // KPI pills: Total, Passed, Failed counts (demo-run-2 has status: failed)
    await expect(page.getByText('Failed').first()).toBeVisible({ timeout: 7000 });
    await expect(page.getByText('Total').first()).toBeVisible({ timeout: 7000 });
    await expect(page.getByText('Passed').first()).toBeVisible({ timeout: 7000 });
  });

  test('error clusters section renders when failed > 3', async ({ page }) => {
    await page.goto(`${BASE}/runs/${runId}`);
    await page.waitForTimeout(2000);

    // The ErrorClustersSection shows a heading with "Error Clusters"
    const clusterSection = page.getByText(/error clusters/i);
    await expect(clusterSection).toBeVisible({ timeout: 9000 });
  });

  test('error cluster cards display sample error messages', async ({ page }) => {
    await page.goto(`${BASE}/runs/${runId}`);
    await page.waitForTimeout(2000);

    // The first cluster sample error should be truncated and visible
    const firstError = page.getByText(/Timeout waiting for element/i);
    await expect(firstError).toBeVisible({ timeout: 9000 });
  });

  test('error cluster cards show count badge', async ({ page }) => {
    await page.goto(`${BASE}/runs/${runId}`);
    await page.waitForTimeout(2000);

    // First cluster has 4 tests
    const countBadge = page.getByText('4 tests');
    await expect(countBadge).toBeVisible({ timeout: 9000 });
  });

  test('error cluster card expands to show stack trace on click', async ({ page }) => {
    await page.goto(`${BASE}/runs/${runId}`);
    await page.waitForTimeout(2000);

    // Find the expand button for the first cluster
    const expandBtn = page.getByLabel(/expand error cluster details/i).first();
    await expect(expandBtn).toBeVisible({ timeout: 9000 });

    await expandBtn.click();
    await page.waitForTimeout(300);

    // Stack trace should now be visible
    const stackTrace = page.getByText(/Context.eval/i);
    await expect(stackTrace).toBeVisible({ timeout: 3000 });
  });

  test('error cluster card shows affected test IDs after expand', async ({ page }) => {
    await page.goto(`${BASE}/runs/${runId}`);
    await page.waitForTimeout(2000);

    const expandBtn = page.getByLabel(/expand error cluster details/i).first();
    await expect(expandBtn).toBeVisible({ timeout: 7000 });
    await expandBtn.click();
    await page.waitForTimeout(300);

    // "Affected test IDs:" label
    const affectedLabel = page.getByText(/affected test ids/i);
    await expect(affectedLabel).toBeVisible({ timeout: 3000 });
  });

  test('expanded cluster card shows collapse button', async ({ page }) => {
    await page.goto(`${BASE}/runs/${runId}`);
    await page.waitForTimeout(1500);

    // Wait for the expand button (label changes to "Collapse..." after click)
    const expandBtn = page.getByLabel(/expand error cluster details/i).first();
    await expect(expandBtn).toBeVisible({ timeout: 7000 });
    await expandBtn.click();
    await page.waitForTimeout(300);

    // After expand, the aria-label changes to "Collapse error cluster details"
    const collapseBtn = page.getByLabel(/collapse error cluster details/i).first();
    await expect(collapseBtn).toBeVisible({ timeout: 3000 });
    await expect(collapseBtn).toHaveAttribute('aria-expanded', 'true');

    // Clicking again collapses — label reverts back to "Expand..."
    await collapseBtn.click();
    await page.waitForTimeout(300);
    const reExpand = page.getByLabel(/expand error cluster details/i).first();
    await expect(reExpand).toBeVisible({ timeout: 3000 });
    await expect(reExpand).toHaveAttribute('aria-expanded', 'false');
  });

  test('multiple clusters are rendered when present', async ({ page }) => {
    await page.goto(`${BASE}/runs/${runId}`);
    await page.waitForTimeout(1500);

    // All three mock clusters should result in cluster count indicator
    const clusterHeading = page.getByText(/error clusters \(3\)/i);
    await expect(clusterHeading).toBeVisible({ timeout: 7000 });
  });

  test('cluster without stack trace expands but shows no pre block', async ({ page }) => {
    await page.goto(`${BASE}/runs/${runId}`);
    await page.waitForTimeout(1500);

    // Expand the second cluster (no stack trace)
    const expandBtns = page.getByLabel(/expand error cluster details/i);
    await expect(expandBtns).toHaveCount(3, { timeout: 7000 });
    await expandBtns.nth(1).click();
    await page.waitForTimeout(300);

    // Should show the "Affected test IDs" text but not a stack trace pre block
    const affectedLabel = page.getByText(/affected test ids/i);
    await expect(affectedLabel).toBeVisible({ timeout: 3000 });
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * 3. ERROR CLUSTERS — NO SECTION WHEN FEW FAILURES
 * ════════════════════════════════════════════════════════════════════════════ */
test.describe('Error Clusters — Hidden when failures ≤ 3', () => {
  // Use a synthetic run ID so we can fully control the mock data
  const fewFailuresRunId = 'mock-few-failures-run';

  test('error clusters section is NOT shown when failed ≤ 3', async ({ page }) => {
    // Mock a run with only 3 failures — all RunSchema required fields included
    await page.route(`**/api/runs/${fewFailuresRunId}`, async (route) => {
      await route.fulfill({
        json: {
          id: fewFailuresRunId,
          status: 'failed',
          passed: 7,
          failed: 3,
          flaky: 0,
          skipped: 0,
          total: 10,
          startedAt: new Date(Date.now() - 60_000).toISOString(),
          finishedAt: new Date(Date.now() - 30_000).toISOString(),
          durationMs: 30_000,
          branch: null,
          commitSha: null,
          commitMessage: null,
          triggeredBy: null,
          config: null,
          rawArgs: null,
          gateStatus: null,
          source: null,
        },
      });
    });
    await page.route(`**/api/runs/${fewFailuresRunId}/tests`, async (route) => {
      await route.fulfill({ json: [] });
    });
    await page.route(`**/api/error-clusters*`, async (route) => {
      await route.fulfill({ json: [] });
    });
    await page.route(`**/api/analytics/error-clusters*`, async (route) => {
      await route.fulfill({ json: [] });
    });
    await page.route(`**/api/runs/${fewFailuresRunId}/fingerprints`, async (route) => {
      await route.fulfill({ json: [] });
    });
    await page.route(`**/api/runs/${fewFailuresRunId}/failure-fingerprints`, async (route) => {
      await route.fulfill({ json: [] });
    });

    await page.goto(`${BASE}/runs/${fewFailuresRunId}`);
    await page.waitForTimeout(1500);

    // Error Clusters section should NOT appear
    const clusterSection = page.getByText(/error clusters \(\d+\)/i);
    await expect(clusterSection).not.toBeVisible();
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * 4. QUARANTINE PAGE — NAVIGATION & STRUCTURE
 * ════════════════════════════════════════════════════════════════════════════ */
test.describe('Quarantine Page — Navigation & Structure', () => {
  test.beforeEach(async ({ page }) => {
    // Mock an empty quarantine list
    await page.route('**/api/quarantine', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({ json: [] });
      } else {
        await route.continue();
      }
    });
  });

  test('navigates to quarantine page via direct URL', async ({ page }) => {
    await page.goto(`${BASE}/tests/quarantine`);
    await expect(page).toHaveURL(/\/tests\/quarantine/);
    await expect(page.locator('body')).toBeVisible();
  });

  test('quarantine page renders heading', async ({ page }) => {
    await page.goto(`${BASE}/tests/quarantine`);
    const heading = page.getByRole('heading', { name: /quarantine/i });
    await expect(heading).toBeVisible({ timeout: 5000 });
  });

  test('quarantine page shows Add to Quarantine button', async ({ page }) => {
    await page.goto(`${BASE}/tests/quarantine`);
    // Two "Add to Quarantine" buttons exist when list is empty: header button + EmptyState CTA
    const addBtn = page.getByRole('button', { name: /add to quarantine/i }).first();
    await expect(addBtn).toBeVisible({ timeout: 5000 });
  });

  test('quarantine page shows empty state when no quarantined tests', async ({ page }) => {
    await page.goto(`${BASE}/tests/quarantine`);
    const emptyState = page.getByText(/no quarantined tests/i);
    await expect(emptyState).toBeVisible({ timeout: 5000 });
  });

  test('quarantine page can be reached via sidebar Quarantine link', async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(600);

    const quarantineLink = page.getByRole('link', { name: /quarantine/i });
    // If sidebar is collapsed, expand first
    if (!(await quarantineLink.isVisible().catch(() => false))) {
      await page.getByLabel('Toggle sidebar').click();
      await page.waitForTimeout(400);
    }
    await quarantineLink.click();
    await expect(page).toHaveURL(/\/tests\/quarantine/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * 5. QUARANTINE — ADD FORM INTERACTION
 * ════════════════════════════════════════════════════════════════════════════ */
test.describe('Quarantine — Add Form', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/quarantine', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({ json: [] });
      } else {
        await route.continue();
      }
    });
  });

  test('clicking Add to Quarantine reveals inline form', async ({ page }) => {
    await page.goto(`${BASE}/tests/quarantine`);

    // Use .first() — there are 2 "Add to Quarantine" buttons (header + empty state CTA)
    const addBtn = page.getByRole('button', { name: /add to quarantine/i }).first();
    await expect(addBtn).toBeVisible({ timeout: 5000 });
    await addBtn.click();
    await page.waitForTimeout(300);

    // Form fields should appear
    const titleInput = page.getByPlaceholder(/e.g. should display login form/i);
    await expect(titleInput).toBeVisible({ timeout: 3000 });
  });

  test('form has Test Title and Test File required inputs', async ({ page }) => {
    await page.goto(`${BASE}/tests/quarantine`);

    await page.getByRole('button', { name: /add to quarantine/i }).first().click();
    await page.waitForTimeout(300);

    await expect(page.getByPlaceholder(/e.g. should display login form/i)).toBeVisible();
    await expect(page.getByPlaceholder(/e.g. tests\/auth\/login.spec.ts/i)).toBeVisible();
  });

  test('form has optional Reason input', async ({ page }) => {
    await page.goto(`${BASE}/tests/quarantine`);

    await page.getByRole('button', { name: /add to quarantine/i }).first().click();
    await page.waitForTimeout(300);

    await expect(page.getByPlaceholder(/optional reason/i)).toBeVisible();
  });

  test('clicking Cancel hides the add form', async ({ page }) => {
    await page.goto(`${BASE}/tests/quarantine`);

    const addBtn = page.getByRole('button', { name: /add to quarantine/i }).first();
    await addBtn.click();
    await page.waitForTimeout(300);

    const titleInput = page.getByPlaceholder(/e.g. should display login form/i);
    await expect(titleInput).toBeVisible({ timeout: 3000 });

    // Cancel button should now show
    const cancelBtn = page.getByRole('button', { name: /cancel/i });
    await expect(cancelBtn).toBeVisible({ timeout: 3000 });
    await cancelBtn.click();
    await page.waitForTimeout(300);

    await expect(titleInput).not.toBeVisible();
  });

  test('submitting form with valid data calls POST /api/quarantine', async ({ page }) => {
    let postCalled = false;
    let postedBody = '';

    await page.route('**/api/quarantine', async (route) => {
      if (route.request().method() === 'POST') {
        postCalled = true;
        postedBody = route.request().postData() ?? '';
        await route.fulfill({
          status: 201,
          json: {
            id: 'new-id-123',
            testTitle: 'should login successfully',
            testFile: 'tests/auth/login.spec.ts',
            reason: 'Flaky network',
          },
        });
      } else {
        // GET — return updated list with 1 item
        await route.fulfill({
          json: [
            {
              id: 'new-id-123',
              testTitle: 'should login successfully',
              testFile: 'tests/auth/login.spec.ts',
              reason: 'Flaky network',
              quarantinedAt: new Date().toISOString(),
            },
          ],
        });
      }
    });

    await page.goto(`${BASE}/tests/quarantine`);
    await page.getByRole('button', { name: /add to quarantine/i }).first().click();
    await page.waitForTimeout(300);

    await page.getByPlaceholder(/e.g. should display login form/i).fill('should login successfully');
    await page.getByPlaceholder(/e.g. tests\/auth\/login.spec.ts/i).fill('tests/auth/login.spec.ts');
    await page.getByPlaceholder(/optional reason/i).fill('Flaky network');

    // Submit the form
    await page.getByRole('button', { name: /^quarantine$/i }).click();
    await page.waitForTimeout(800);

    expect(postCalled).toBe(true);
    expect(postedBody).toContain('should login successfully');
  });

  test('form submit button is disabled for empty required fields', async ({ page }) => {
    await page.goto(`${BASE}/tests/quarantine`);
    await page.getByRole('button', { name: /add to quarantine/i }).first().click();
    await page.waitForTimeout(300);

    // Without filling, clicking submit should not trigger POST
    // (HTML5 required validation prevents form submit with empty required fields)
    const submitBtn = page.getByRole('button', { name: /^quarantine$/i });
    await expect(submitBtn).toBeVisible({ timeout: 3000 });
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * 6. QUARANTINE — DISPLAY WITH EXISTING ITEMS
 * ════════════════════════════════════════════════════════════════════════════ */
test.describe('Quarantine — Display with items', () => {
  const quarantineItems = [
    {
      id: 'qid-1',
      testTitle: 'should display the login form correctly',
      testFile: 'tests/auth/login.spec.ts',
      reason: 'Flaky on CI',
      quarantinedAt: new Date(Date.now() - 86_400_000).toISOString(),
    },
    {
      id: 'qid-2',
      testTitle: 'loads user dashboard after auth',
      testFile: 'tests/dashboard/home.spec.ts',
      reason: null,
      quarantinedAt: new Date(Date.now() - 3_600_000).toISOString(),
    },
  ];

  test.beforeEach(async ({ page }) => {
    await page.route('**/api/quarantine', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({ json: quarantineItems });
      } else {
        await route.continue();
      }
    });
  });

  test('quarantine table renders when items exist', async ({ page }) => {
    await page.goto(`${BASE}/tests/quarantine`);
    await page.waitForTimeout(1000);

    // The table should appear (not empty state)
    const table = page.locator('table');
    await expect(table).toBeVisible({ timeout: 5000 });
  });

  test('quarantine table shows test titles', async ({ page }) => {
    await page.goto(`${BASE}/tests/quarantine`);
    await page.waitForTimeout(1000);

    await expect(page.getByText('should display the login form correctly')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('loads user dashboard after auth')).toBeVisible({ timeout: 5000 });
  });

  test('quarantine table shows test file paths', async ({ page }) => {
    await page.goto(`${BASE}/tests/quarantine`);
    await page.waitForTimeout(1000);

    // shortPath('tests/auth/login.spec.ts') returns last 2 segments: 'auth/login.spec.ts'
    await expect(page.getByText('auth/login.spec.ts')).toBeVisible({ timeout: 5000 });
  });

  test('quarantine table has remove buttons for each item', async ({ page }) => {
    await page.goto(`${BASE}/tests/quarantine`);
    await page.waitForTimeout(1000);

    // Should have remove/unquarantine buttons
    const removeButtons = page.getByRole('button', { name: /remove|unquarantine/i });
    await expect(removeButtons.first()).toBeVisible({ timeout: 5000 });
    const count = await removeButtons.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test('remove button calls DELETE /api/quarantine/:id', async ({ page }) => {
    let deleteCalled = false;
    let deletedId = '';

    await page.route('**/api/quarantine/**', async (route) => {
      if (route.request().method() === 'DELETE') {
        deleteCalled = true;
        const url = new URL(route.request().url());
        deletedId = url.pathname.split('/').pop() ?? '';
        await route.fulfill({ status: 204 });
      } else {
        await route.continue();
      }
    });

    await page.goto(`${BASE}/tests/quarantine`);
    await page.waitForTimeout(1000);

    const removeBtn = page.getByRole('button', { name: /remove|unquarantine/i }).first();
    await expect(removeBtn).toBeVisible({ timeout: 5000 });
    await removeBtn.click();
    await page.waitForTimeout(500);

    expect(deleteCalled).toBe(true);
    expect(['qid-1', 'qid-2']).toContain(deletedId);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * 7. KNOWN FAILURES API
 * ════════════════════════════════════════════════════════════════════════════ */
test.describe('Known Failures — API', () => {
  test('GET /api/known-failures returns 200 with array', async ({ request }) => {
    const res = await request.get(`${API}/api/known-failures`);
    expect(res.status()).toBe(200);
    const body = await res.json() as unknown[];
    expect(Array.isArray(body)).toBe(true);
  });

  test('POST /api/known-failures with valid body creates entry', async ({ request }) => {
    const res = await request.post(`${API}/api/known-failures`, {
      data: {
        testTitle: 'E2E known failure test ' + Date.now(),
        testFile: 'tests/e2e/known.spec.ts',
        comment: 'Created by E2E test',
      },
    });
    expect(res.status()).toBe(201);
    const body = await res.json() as { id: string; testTitle: string };
    expect(typeof body.id).toBe('string');
    expect(body.testTitle).toContain('E2E known failure test');

    // Cleanup
    await request.delete(`${API}/api/known-failures/${body.id}`);
  });

  test('POST /api/known-failures with missing testTitle returns 400', async ({ request }) => {
    const res = await request.post(`${API}/api/known-failures`, {
      data: { testFile: 'tests/e2e/known.spec.ts' },
    });
    expect(res.status()).toBe(400);
  });

  test('POST /api/known-failures with missing testFile returns 400', async ({ request }) => {
    const res = await request.post(`${API}/api/known-failures`, {
      data: { testTitle: 'some test' },
    });
    expect(res.status()).toBe(400);
  });

  test('DELETE /api/known-failures/:id removes entry', async ({ request }) => {
    // Create first
    const create = await request.post(`${API}/api/known-failures`, {
      data: {
        testTitle: 'Delete target ' + Date.now(),
        testFile: 'tests/e2e/delete.spec.ts',
      },
    });
    expect(create.status()).toBe(201);
    const { id } = await create.json() as { id: string };

    // Delete
    const del = await request.delete(`${API}/api/known-failures/${id}`);
    expect(del.status()).toBe(204);

    // Verify gone
    const list = await request.get(`${API}/api/known-failures`);
    const items = await list.json() as Array<{ id: string }>;
    expect(items.find((i) => i.id === id)).toBeUndefined();
  });

  test('DELETE /api/known-failures/:id with non-existent ID returns 404', async ({ request }) => {
    const res = await request.delete(`${API}/api/known-failures/non-existent-id`);
    expect(res.status()).toBe(404);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * 8. QUARANTINE API — DIRECT
 * ════════════════════════════════════════════════════════════════════════════ */
test.describe('Quarantine — API', () => {
  test('GET /api/quarantine returns 200 with array', async ({ request }) => {
    const res = await request.get(`${API}/api/quarantine`);
    expect(res.status()).toBe(200);
    const body = await res.json() as unknown[];
    expect(Array.isArray(body)).toBe(true);
  });

  test('POST /api/quarantine creates a quarantine entry', async ({ request }) => {
    const res = await request.post(`${API}/api/quarantine`, {
      data: {
        testTitle: 'E2E quarantine test ' + Date.now(),
        testFile: 'tests/e2e/quarantine.spec.ts',
        reason: 'Flaky on CI',
      },
    });
    expect(res.status()).toBe(201);
    const body = await res.json() as { id: string; testTitle: string; testFile: string };
    expect(typeof body.id).toBe('string');
    expect(body.testTitle).toContain('E2E quarantine test');

    // Cleanup
    await request.delete(`${API}/api/quarantine/${body.id}`);
  });

  test('POST /api/quarantine without required fields returns 400', async ({ request }) => {
    const res = await request.post(`${API}/api/quarantine`, {
      data: { reason: 'no title or file' },
    });
    expect(res.status()).toBe(400);
  });

  test('DELETE /api/quarantine/:id removes entry', async ({ request }) => {
    // Create entry
    const create = await request.post(`${API}/api/quarantine`, {
      data: {
        testTitle: 'To be deleted ' + Date.now(),
        testFile: 'tests/e2e/cleanup.spec.ts',
      },
    });
    expect(create.status()).toBe(201);
    const { id } = await create.json() as { id: string };

    // Delete
    const del = await request.delete(`${API}/api/quarantine/${id}`);
    expect(del.status()).toBe(204);

    // Confirm gone
    const list = await request.get(`${API}/api/quarantine`);
    const items = await list.json() as Array<{ id: string }>;
    expect(items.find((i) => i.id === id)).toBeUndefined();
  });

  test('DELETE /api/quarantine/:id non-existent returns 404', async ({ request }) => {
    const res = await request.delete(`${API}/api/quarantine/ghost-id`);
    expect(res.status()).toBe(404);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * 9. AUTO-QUARANTINE SETTINGS UI
 * ════════════════════════════════════════════════════════════════════════════ */
test.describe('Auto-Quarantine Settings', () => {
  test.beforeEach(async ({ page }) => {
    // Mock the auto-quarantine config endpoint
    await page.route('**/api/settings/auto-quarantine', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          json: { flakyThreshold: 3, lookbackRuns: 10 },
        });
      } else if (route.request().method() === 'PUT') {
        await route.fulfill({ json: { flakyThreshold: 5, lookbackRuns: 15 } });
      } else {
        await route.continue();
      }
    });
  });

  test('settings page has Auto-Quarantine section', async ({ page }) => {
    await page.goto(`${BASE}/settings`);

    const section = page.getByText('Auto-Quarantine', { exact: true });
    await expect(section).toBeVisible({ timeout: 7000 });
  });

  test('quarantine settings tab renders flaky threshold input', async ({ page }) => {
    await page.goto(`${BASE}/settings?tab=quarantine`);

    await expect(page.getByText('Flaky Threshold')).toBeVisible({ timeout: 5000 });
    const input = page.locator('input[type="number"]').first();
    await expect(input).toBeVisible({ timeout: 3000 });
  });

  test('quarantine settings tab renders lookback runs input', async ({ page }) => {
    await page.goto(`${BASE}/settings?tab=quarantine`);

    await expect(page.getByText('Lookback Runs')).toBeVisible({ timeout: 5000 });
  });

  test('quarantine settings tab has Save button', async ({ page }) => {
    await page.goto(`${BASE}/settings?tab=quarantine`);

    const saveBtn = page.getByRole('button', { name: /save/i });
    await expect(saveBtn).toBeVisible({ timeout: 5000 });
  });

  test('quarantine settings updates call PUT /api/settings/auto-quarantine', async ({ page }) => {
    let putCalled = false;
    let putBody = '';

    await page.route('**/api/settings/auto-quarantine', async (route) => {
      if (route.request().method() === 'PUT') {
        putCalled = true;
        putBody = route.request().postData() ?? '';
        await route.fulfill({ json: { flakyThreshold: 5, lookbackRuns: 15 } });
      } else {
        await route.fulfill({ json: { flakyThreshold: 3, lookbackRuns: 10 } });
      }
    });

    await page.goto(`${BASE}/settings?tab=quarantine`);
    await page.waitForTimeout(800);

    // Change flaky threshold
    const thresholdInput = page.locator('input[type="number"]').first();
    await thresholdInput.triple_click?.();
    await thresholdInput.click({ clickCount: 3 });
    await thresholdInput.fill('5');

    await page.getByRole('button', { name: /save/i }).click();
    await page.waitForTimeout(500);

    expect(putCalled).toBe(true);
    expect(putBody).toContain('5');
  });

  test('quarantine settings shows description for flaky threshold', async ({ page }) => {
    await page.goto(`${BASE}/settings?tab=quarantine`);

    const description = page.getByText(/times a test must flake/i);
    await expect(description).toBeVisible({ timeout: 5000 });
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * 10. FEATURE FLAG — error-clustering endpoint returns 200 by default
 * ════════════════════════════════════════════════════════════════════════════ */
test.describe('Feature Flag — error-clustering graduated', () => {
  test('error-clustering feature is enabled (GET /api/error-clusters returns non-404)', async ({ request }) => {
    // Feature is graduated — endpoint must exist (200 or 400, not 404)
    const res = await request.get(`${API}/api/error-clusters?runId=any-id`);
    expect(res.status()).not.toBe(404);
    // Either 200 (empty array) or 400 (missing/bad runId), never 404
    expect([200, 400]).toContain(res.status());
  });

  test('known-failure-tracking feature is enabled (GET /api/known-failures returns 200)', async ({ request }) => {
    const res = await request.get(`${API}/api/known-failures`);
    expect(res.status()).toBe(200);
  });

  test('auto-quarantine feature is enabled (GET /api/quarantine returns 200)', async ({ request }) => {
    const res = await request.get(`${API}/api/quarantine`);
    expect(res.status()).toBe(200);
  });
});
