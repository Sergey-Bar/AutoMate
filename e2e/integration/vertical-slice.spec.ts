/**
 * vertical-slice.spec.ts — T17/T29 vertical slice E2E integration test
 *
 * Proves the full reporter → persistence → API → browser path works:
 *
 * 1. POST reporter event to /api/v1/reporter/events (ingest)
 * 2. GET /api/v1/runs (API evidence — asserts the run appears)
 * 3. GET /api/v1/runs with invalid event (negative case)
 * 4. Browser: navigate to /dashboard, assert [data-testid="run-item-e2e-prod-ready-run-001"] is visible
 *    — NEVER allows empty/loading/error states to pass
 * 5. SSE live update: seed run as running → POST run:end → assert status changes to "passed" without reload
 *
 * Evidence files saved:
 *   test-results/evidence/runs-api.json       (from step 2 — API JSON)
 *   test-results/evidence/invalid-reporter-response.json  (from step 3)
 *   test-results/evidence/vertical-slice/dashboard-run-item.png  (step 4 screenshot)
 *   test-results/evidence/vertical-slice/vertical-slice-sse-live-update.txt     (step 5 text summary)
 *
 * Prerequisites (handled by playwright.config.ts webServer):
 *   - API server running on http://localhost:3000
 *   - Vite dev server running on http://localhost:5173 (proxies /api → 3000)
 */
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Evidence directories
// ---------------------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/**
 * Evidence goes to `test-results/evidence`, which CI uploads as an artifact.
 *
 * It used to go to `.sisyphus/evidence/`, which `.gitignore` ignores — so the
 * artifacts the suite exists to produce were written, never committed and never
 * uploaded. The filenames were also agent bookkeeping (`task-17-…`,
 * `task-29-…`) leaked into a product test; they are named for what they show.
 */
const EVIDENCE_DIR = path.resolve(__dirname, '../../test-results/evidence');
const EVIDENCE_DIR_T29 = path.join(EVIDENCE_DIR, 'vertical-slice');

function saveEvidence(filename: string, data: unknown): void {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  fs.writeFileSync(path.join(EVIDENCE_DIR, filename), JSON.stringify(data, null, 2), 'utf-8');
}

function saveEvidenceT29(filename: string, content: string): void {
  fs.mkdirSync(EVIDENCE_DIR_T29, { recursive: true });
  fs.writeFileSync(path.join(EVIDENCE_DIR_T29, filename), content, 'utf-8');
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const API_BASE = 'http://127.0.0.1:3000';
const WEB_BASE = 'http://localhost:5173';
const API_AUTH_HEADERS = { Authorization: 'Bearer e2e-installation-key' };

async function waitForRunInApi(
  request: APIRequestContext,
  runId: string,
): Promise<Record<string, unknown>> {
  await expect
    .poll(
      async () => {
        const res = await request.get(`${API_BASE}/api/v1/runs`, { headers: API_AUTH_HEADERS });
        if (res.status() !== 200) return null;
        const runs = (await res.json()) as Array<Record<string, unknown>>;
        return runs.find((run) => run['id'] === runId) ?? null;
      },
      {
        message: `run ${runId} should be persisted before opening the dashboard`,
        timeout: 10_000,
      },
    )
    .not.toBeNull();

  const res = await request.get(`${API_BASE}/api/v1/runs`, { headers: API_AUTH_HEADERS });
  const runs = (await res.json()) as Array<Record<string, unknown>>;
  const run = runs.find((item) => item['id'] === runId);
  expect(run).toBeDefined();
  return run!;
}

async function authenticateBrowser(page: Page): Promise<void> {
  await page.goto(`${WEB_BASE}/login?return=%2Fdashboard`);
  await page.getByRole('textbox', { name: 'API Key' }).fill('e2e-installation-key');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('**/dashboard');
}

// ---------------------------------------------------------------------------
// 1. API-level integration: POST reporter event → GET /api/v1/runs
// ---------------------------------------------------------------------------

test('vertical slice — reporter event reaches run list (API)', async ({ request }) => {
  const RUN_ID = 'e2e_slice_run_001';

  // Step 1: POST a run:start event
  const postRes = await request.post(`${API_BASE}/api/v1/reporter/events`, {
    headers: API_AUTH_HEADERS,
    data: {
      type: 'run:start',
      runId: RUN_ID,
      payload: { total: 3, branch: 'main', commitSha: 'cafecafe' },
    },
  });
  expect(postRes.status()).toBe(202);

  const postBody = await postRes.json();
  expect(postBody.ok).toBe(true);
  expect(postBody.runId).toBe(RUN_ID);

  // Step 2: GET /api/v1/runs — run must appear
  const getRes = await request.get(`${API_BASE}/api/v1/runs`, { headers: API_AUTH_HEADERS });
  expect(getRes.status()).toBe(200);

  const runs = (await getRes.json()) as Array<Record<string, unknown>>;
  const found = runs.find((r) => r['id'] === RUN_ID);
  expect(found).toBeDefined();
  expect(found?.['status']).toBe('running');
  expect(found?.['total']).toBe(3);
  expect(found?.['branch']).toBe('main');

  // Save API evidence
  saveEvidence('runs-api.json', runs);
});

// ---------------------------------------------------------------------------
// 2. Negative case: invalid event → run not created
// ---------------------------------------------------------------------------

test('vertical slice — invalid event rejected, no run created (API negative)', async ({
  request,
}) => {
  // POST invalid event (missing runId)
  const invalidRes = await request.post(`${API_BASE}/api/v1/reporter/events`, {
    headers: API_AUTH_HEADERS,
    data: { type: 'run:start', payload: { total: 1 } },
  });
  expect(invalidRes.status()).toBe(400);

  const invalidBody = await invalidRes.json();
  expect(typeof invalidBody.error).toBe('string');

  // GET runs — assert no run with the invalid payload was created
  const getRes = await request.get(`${API_BASE}/api/v1/runs`, { headers: API_AUTH_HEADERS });
  const runs = (await getRes.json()) as Array<Record<string, unknown>>;

  // No run should exist without a runId
  const badRun = runs.find((r) => r['id'] === undefined || r['id'] === '');
  expect(badRun).toBeUndefined();

  saveEvidence('invalid-reporter-response.json', {
    postStatus: invalidRes.status(),
    postBody: invalidBody,
    runsAfterInvalidEvent: runs,
  });
});

// ---------------------------------------------------------------------------
// 3. SSE endpoint responds with correct content-type
// ---------------------------------------------------------------------------

test('vertical slice — SSE /api/v1/events returns 200 text/event-stream', async ({ request }) => {
  // A streaming endpoint never ends, so a plain `request.get` can only observe
  // the response *headers*. The previous version called `.catch(() => null)` and
  // then wrapped its only assertions in `if (res !== null)`, so a deleted
  // `/api/v1/events` route and a working one produced the same green test: the
  // timeout was described as "expected for a streaming endpoint", which is
  // indistinguishable from the route not existing.
  //
  // `failOnStatusCode: false` stops Playwright throwing on the 200, and the
  // request is bounded by an AbortController rather than by swallowing the
  // error — so a 404, a 401, or a connection refusal all fail here.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2000);
  try {
    const res = await request.get(`${API_BASE}/api/v1/events`, {
      headers: API_AUTH_HEADERS,
      failOnStatusCode: false,
      timeout: 2000,
    });
    expect(res.status(), 'SSE endpoint must answer 200').toBe(200);
    expect(res.headers()['content-type']).toContain('text/event-stream');
  } catch (error) {
    // A timeout is only acceptable if the response headers were already seen.
    // Playwright's request API does not surface partial responses, so we assert
    // reachability with a bounded probe instead of guessing.
    const probe = await fetch(`${API_BASE}/api/v1/health`, {
      headers: API_AUTH_HEADERS,
      signal: AbortSignal.timeout(2000),
    }).catch(() => null);
    expect(
      probe,
      `SSE endpoint was unreachable: ${error instanceof Error ? error.message : String(error)}`,
    ).not.toBeNull();
    throw new Error(
      'SSE endpoint could not be inspected for headers. The endpoint must be ' +
        'verifiable: a timeout is not proof the route exists.',
    );
  } finally {
    clearTimeout(timer);
  }
});

// ---------------------------------------------------------------------------
// 4. Browser E2E (T29 strengthened): exact seeded run MUST appear — no empty/loading/error allowed
// ---------------------------------------------------------------------------

test('vertical slice — browser shows exact seeded run-item (T29)', async ({ page, request }) => {
  const RUN_ID = 'e2e-prod-ready-run-001';

  // Seed the run via Node.js fetch (not browser fetch)
  const seedRes = await fetch(`${API_BASE}/api/v1/reporter/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...API_AUTH_HEADERS },
    body: JSON.stringify({
      type: 'run:start',
      runId: RUN_ID,
      payload: { total: 5, branch: 'main', commitSha: 'deadbeef00' },
    }),
  });
  expect(seedRes.status).toBe(202);

  await waitForRunInApi(request, RUN_ID);

  // Navigate to the dashboard
  await authenticateBrowser(page);
  await page.goto(`${WEB_BASE}/dashboard`);

  // Wait for the exact run item — this MUST appear.
  // If runs-empty, runs-loading, or runs-error appear instead, this test FAILS (as intended).
  await page.waitForSelector(`[data-testid="run-item-${RUN_ID}"]`, { timeout: 15000 });

  // Hard assertion: the exact run item element must be visible
  await expect(page.locator(`[data-testid="run-item-${RUN_ID}"]`)).toBeVisible();

  // Take screenshot as evidence
  fs.mkdirSync(EVIDENCE_DIR_T29, { recursive: true });
  await page.screenshot({
    path: path.join(EVIDENCE_DIR_T29, 'dashboard-run-item.png'),
    fullPage: true,
  });
});

// ---------------------------------------------------------------------------
// 5. SSE live update (T29): seed run → navigate → POST run:end → status changes without reload
// ---------------------------------------------------------------------------

test('vertical slice — SSE live update: run:end changes status to passed without reload (T29)', async ({
  page,
  request,
}) => {
  const RUN_ID = 'e2e-sse-run-001';

  // Step 1: Seed run as running
  const seedRes = await fetch(`${API_BASE}/api/v1/reporter/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...API_AUTH_HEADERS },
    body: JSON.stringify({
      type: 'run:start',
      runId: RUN_ID,
      payload: { total: 2, branch: 'feat/sse-test' },
    }),
  });
  expect(seedRes.status).toBe(202);

  await waitForRunInApi(request, RUN_ID);

  // Step 2: Navigate to dashboard and wait for the run item to appear
  await authenticateBrowser(page);
  await page.goto(`${WEB_BASE}/dashboard`);
  await page.waitForSelector(`[data-testid="run-item-${RUN_ID}"]`, { timeout: 15000 });

  // Verify initial status is "running"
  const statusLocator = page.locator(`[data-testid="run-status-${RUN_ID}"]`);
  await expect(statusLocator).toBeVisible();
  await expect(statusLocator).toContainText('running');

  // Step 3: POST run:end via Node.js fetch (not via the browser — simulates reporter finishing)
  const endRes = await fetch(`${API_BASE}/api/v1/reporter/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...API_AUTH_HEADERS },
    body: JSON.stringify({
      type: 'run:end',
      runId: RUN_ID,
      payload: { status: 'passed', passed: 2, failed: 0 },
    }),
  });
  expect(endRes.status).toBe(202);

  // Step 4: assert the flip came from the stream, not from the 5-second poll.
  //
  // `useRuns.ts:107` also refreshes on a `setInterval`, so "the status eventually
  // changed" cannot tell SSE apart from polling. Polling is disabled for the
  // duration of this test and the transition is required inside one poll
  // interval, which only a pushed event can satisfy.
  const POLL_INTERVAL_MS = 5_000;
  await page.evaluate(() => {
    (window as unknown as { __pollDisabled?: boolean }).__pollDisabled = true;
  });

  const beforePollDeadline = Date.now();
  await page.waitForFunction(
    (runId: string) => {
      const el = document.querySelector(`[data-testid="run-status-${runId}"]`);
      return el !== null && (el.textContent ?? '').toLowerCase().includes('passed');
    },
    RUN_ID,
    { timeout: POLL_INTERVAL_MS - 1_000 },
  );
  const elapsedMs = Date.now() - beforePollDeadline;
  expect(
    elapsedMs,
    `status flipped after ${elapsedMs}ms, which is within the ${POLL_INTERVAL_MS}ms poll ` +
      'interval, so this could be polling rather than SSE',
  ).toBeLessThan(POLL_INTERVAL_MS - 1_000);

  // Hard assertion: status element now shows "passed"
  await expect(statusLocator).toContainText('passed');

  await page.evaluate(() => {
    delete (window as unknown as { __pollDisabled?: boolean }).__pollDisabled;
  });

  // Evidence derived from observed state, not from a hard-coded "PASSED" line.
  const observedStatus = (await statusLocator.textContent())?.trim() ?? '';
  const observedRunTitle = (await page.locator(`[data-testid="run-item-${RUN_ID}"]`).textContent())
    ?.trim()
    .replace(/\s+/g, ' ');
  const summary = [
    'SSE live update — observed transition',
    `runId: ${RUN_ID}`,
    `seeded status: running`,
    `observed status: ${observedStatus}`,
    `mechanism: pushed event, flip observed in ${elapsedMs}ms ` +
      `(poll interval is ${POLL_INTERVAL_MS}ms)`,
    `run item text: ${observedRunTitle ?? ''}`,
    `observed at: ${new Date().toISOString()}`,
  ].join('\n');

  expect(observedStatus.toLowerCase()).toContain('passed');

  saveEvidenceT29('vertical-slice-sse-live-update.txt', summary);
});
