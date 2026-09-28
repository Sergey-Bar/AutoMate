/**
 * A run created through the reporter, progressing to completion, visible in the
 * dashboard.
 *
 * The path exercised is the one a real producer uses: `POST /api/v1/reporter/events`
 * → `DrizzleRunRepository` → `GET /api/v1/runs` → the browser. Nothing here
 * creates a run through the Command Center form, because that form is not how
 * test evidence arrives.
 *
 * The page assertions name one exact run and forbid the states that would
 * otherwise pass: `runs-list-empty` and `runs-list-error` must both be absent.
 * A dashboard that failed to load and a dashboard with no evidence look the same
 * to "an element with this id exists".
 */
import { expect, test } from '@playwright/test';
import { postReporterEvent, reportTest, uniqueRunId, waitForRunPhase } from '../support/api.js';
import { WEB_BASE } from '../support/config.js';
import { observedSummary, saveEvidence, saveEvidenceText } from '../support/evidence.js';
import { authenticate, signInAndVisit } from '../support/session.js';

const TOTAL_TESTS = 3;

test.describe('reporter run lifecycle', () => {
  test('a reporter run reaches a terminal outcome and renders in the dashboard', async ({
    page,
    context,
    request,
  }) => {
    const runId = uniqueRunId();
    const branch = 'feat/reporter-lifecycle';

    // 1. A producer announces a run. Nothing in the browser is involved yet.
    await postReporterEvent(request, {
      type: 'run:start',
      runId,
      payload: { total: TOTAL_TESTS, branch, commitSha: 'cafecafe0011' },
    });

    // 2. The API has really persisted it, as a running run — not merely accepted
    //    the event. Asserted before any page is opened so a later "the run was
    //    there all along" cannot be blamed on the dashboard's own fetch.
    const running = await waitForRunPhase(request, runId, ['running', 'queued', 'assigned']);
    expect(running.outcome, 'a run with no result yet must not carry an outcome').toBeNull();
    expect(running.summary.total).toBe(TOTAL_TESTS);
    expect(running.branch).toBe(branch);

    // 3. The producer reports each test, then the run. The counters come from the
    //    per-test events, so a spec that only sent `run:end` would be asserting
    //    against a run the API never recorded any test in.
    for (let index = 0; index < TOTAL_TESTS; index += 1) {
      await reportTest(request, runId, {
        testId: `${runId}-test-${index + 1}`,
        title: `passing test ${index + 1}`,
        file: 'e2e/vertical-slice.spec.ts',
        status: 'passed',
        durationMs: 20,
      });
    }
    await postReporterEvent(request, {
      type: 'run:end',
      runId,
      payload: { status: 'passed', passed: TOTAL_TESTS, failed: 0, branch, durationMs: 60 },
    });
    const completed = await waitForRunPhase(request, runId, ['complete']);
    expect(completed.outcome).toBe('passed');
    expect(completed.summary.passed, 'every reported test must be counted').toBe(TOTAL_TESTS);
    expect(completed.summary.failed).toBe(0);

    // 4. The Command Center shows that exact run, in a state that is neither
    //    "still loading" nor "nothing to show".
    await authenticate(context, request);
    await signInAndVisit(page, '/dashboard');

    const runItem = page.getByTestId(`run-item-${runId}`);
    await expect(runItem, 'the seeded run must appear in the Command Center').toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId('run-status-' + runId)).toHaveText(/passed/i);

    // 5. The Runs table agrees, and is a table rather than an empty state.
    await signInAndVisit(page, '/dashboard/runs');
    const row = page.getByTestId(`run-row-${runId}`);
    await expect(row, 'the seeded run must appear in the Runs table').toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId(`run-outcome-${runId}`)).toHaveText('passed');
    await expect(page.getByTestId('runs-list-empty')).toHaveCount(0);
    await expect(page.getByTestId('runs-list-error')).toHaveCount(0);
    await expect(page.getByTestId('runs-list-loading')).toHaveCount(0);

    // 6. The detail view is reachable and shows the run's own evidence.
    await row.getByRole('link').first().click();
    await expect(page).toHaveURL(new RegExp(`/dashboard/runs/${runId}$`));
    await expect(page.getByTestId('run-detail-page')).toBeVisible();
    await expect(page.getByTestId('run-status')).toHaveText('PASSED');
    await expect(page.getByTestId('run-total')).toHaveText(String(TOTAL_TESTS));
    await expect(page.getByTestId('run-passed')).toHaveText(String(TOTAL_TESTS));

    saveEvidence('reporter-lifecycle', 'run.json', {
      runId,
      running: { phase: running.phase, outcome: running.outcome, total: running.summary.total },
      completed: {
        phase: completed.phase,
        outcome: completed.outcome,
        passed: completed.summary.passed,
        durationMs: completed.summary.durationMs,
      },
    });

    const observedStatus = (await page.getByTestId('run-status').textContent())?.trim() ?? '';
    saveEvidenceText(
      'reporter-lifecycle',
      'observed-terminal-state.txt',
      observedSummary('Reporter run — observed terminal state', {
        'run id': runId,
        'api phase': completed.phase,
        'api outcome': String(completed.outcome),
        'rendered status badge': observedStatus,
        'rendered total': (await page.getByTestId('run-total').textContent())?.trim() ?? '',
        'detail url': page.url().replace(WEB_BASE, ''),
      }),
    );
  });

  test('a reporter run that reports a failure is never shown as passed', async ({
    page,
    context,
    request,
  }) => {
    const runId = uniqueRunId();

    await postReporterEvent(request, {
      type: 'run:start',
      runId,
      payload: { total: 2, branch: 'main', commitSha: 'badcafe0011' },
    });
    await waitForRunPhase(request, runId, ['running', 'queued', 'assigned']);
    await reportTest(request, runId, {
      testId: `${runId}-ok`,
      title: 'passing test',
      file: 'e2e/vertical-slice.spec.ts',
      status: 'passed',
    });
    await reportTest(request, runId, {
      testId: `${runId}-broken`,
      title: 'failing test',
      file: 'e2e/vertical-slice.spec.ts',
      status: 'failed',
    });
    await postReporterEvent(request, {
      type: 'run:end',
      runId,
      payload: { status: 'failed', passed: 1, failed: 1, branch: 'main' },
    });
    const failed = await waitForRunPhase(request, runId, ['complete']);
    expect(failed.outcome).toBe('failed');
    expect(failed.summary.failed).toBe(1);
    expect(failed.summary.passed).toBe(1);

    await authenticate(context, request);
    await signInAndVisit(page, '/dashboard');
    await expect(page.getByTestId(`run-status-${runId}`)).toHaveText(/failed/i, {
      timeout: 15_000,
    });

    saveEvidence('reporter-lifecycle', 'failed-run.json', {
      runId,
      phase: failed.phase,
      outcome: failed.outcome,
      summary: failed.summary,
    });
  });
});
