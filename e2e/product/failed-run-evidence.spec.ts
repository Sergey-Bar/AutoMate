/**
 * A failed run, rendered as failed, with its evidence downloadable.
 *
 * The run is failed the only way a run can be failed: a runner completes its job
 * with an outcome and a test result carrying an error. Declaring `status: failed`
 * in a request body without the corresponding failing test row is how a product
 * learns to trust its own callers, and this spec deliberately does not do that.
 *
 * The artifact assertion is the download, not the link. A link with a 404 behind
 * it is a broken evidence trail that still renders as evidence.
 */
import { expect, test } from '@playwright/test';
import {
  claimJob,
  completeJob,
  createRun,
  registerRunner,
  uploadArtifact,
  waitForRunPhase,
} from '../support/api.js';
import { API_BASE, WEB_BASE } from '../support/config.js';
import { observedSummary, saveEvidence, saveEvidenceText } from '../support/evidence.js';
import { authenticate, signInAndVisit } from '../support/session.js';

const LOG_BODY = 'runner log: 2 tests, 1 failure\nassertion failed at a.spec.ts:12\n';

test.describe('failed run and its evidence', () => {
  test('a failed run renders as failed and its artifact downloads byte for byte', async ({
    page,
    context,
    request,
  }) => {
    const created = await createRun(request, { branch: 'feat/failed-evidence' });
    const runner = await registerRunner(request);
    const job = await claimJob(request, runner, ['playwright'], created.id);
    expect(job.runId).toBe(created.id);

    const descriptor = await uploadArtifact(request, runner, job, {
      name: 'runner.log',
      kind: 'log',
      contentType: 'text/plain',
      body: LOG_BODY,
    });
    expect(descriptor.sizeBytes).toBe(Buffer.byteLength(LOG_BODY, 'utf-8'));

    const completed = await completeJob(request, runner, job, {
      outcome: 'failed',
      summary: { total: 2, passed: 1, failed: 1 },
      tests: [
        { id: 'e2e-test-passing', title: 'passing test', file: 'a.spec.ts', status: 'passed' },
        {
          id: 'e2e-test-failing',
          title: 'failing test',
          file: 'a.spec.ts',
          status: 'failed',
          durationMs: 42,
          error: { code: 'ASSERTION_FAILED', message: 'expected 1 to equal 2' },
        },
      ],
    });

    expect(completed.outcome, 'a run with a failing test must be failed').toBe('failed');
    const settled = await waitForRunPhase(request, created.id, ['complete']);
    expect(settled.outcome).toBe('failed');
    expect(settled.summary.failed).toBe(1);
    expect(settled.summary.passed).toBe(1);

    await authenticate(context, request);
    await signInAndVisit(page, `/dashboard/runs/${created.id}`);

    await expect(page.getByTestId('run-detail-page')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('run-status')).toHaveText('FAILED');
    await expect(page.getByTestId('run-phase')).toHaveText('complete');
    await expect(page.getByTestId('run-failed')).toHaveText('1');
    await expect(page.getByTestId('run-passed')).toHaveText('1');

    // The failing test's own error is on screen, not just a count.
    const failingTest = page.getByTestId('test-e2e-test-failing');
    await expect(failingTest).toBeVisible();
    await expect(page.getByTestId('test-error-e2e-test-failing')).toContainText(
      'expected 1 to equal 2',
    );

    // The artifact is offered...
    const artifactLink = page.getByRole('link', { name: 'runner.log' });
    await expect(artifactLink).toBeVisible();

    // ...and what it serves is the bytes that were uploaded. Asserted through the
    // page's own origin, with the session cookie, because that is the way a user
    // gets the evidence: an unauthenticated fetch of the same URL is 401.
    const href = await artifactLink.getAttribute('href');
    expect(href).toBe(`/api/v1/artifacts/${descriptor.id}`);
    const download = await page.request.get(`${WEB_BASE}${href as string}`);
    expect(download.status(), 'the artifact must be downloadable with a session').toBe(200);
    expect(download.headers()['content-type']).toBe('text/plain');
    expect(await download.text()).toBe(LOG_BODY);
    expect(download.headers()['content-disposition']).toContain('runner.log');

    // The same URL without a credential is refused. Evidence is not public.
    const anonymous = await request.get(`${API_BASE}/api/v1/artifacts/${descriptor.id}`);
    expect(anonymous.status(), 'artifact bytes must require a credential').toBe(401);

    saveEvidence('failed-run-evidence', 'failed-run-and-artifact.json', {
      runId: created.id,
      jobId: job.jobId,
      artifact: descriptor,
      phase: settled.phase,
      outcome: settled.outcome,
      summary: settled.summary,
      anonymousDownloadStatus: anonymous.status(),
    });

    saveEvidenceText(
      'failed-run-evidence',
      'observed-failed-state.txt',
      observedSummary('Failed run — observed state', {
        'run id': created.id,
        'api phase': settled.phase,
        'api outcome': String(settled.outcome),
        'rendered status': (await page.getByTestId('run-status').textContent())?.trim() ?? '',
        'rendered failed count': (await page.getByTestId('run-failed').textContent())?.trim() ?? '',
        'artifact name': descriptor.name,
        'artifact size': descriptor.sizeBytes,
        'download status (session)': download.status(),
        'download status (anonymous)': anonymous.status(),
        'bytes match upload': String((await download.text()) === LOG_BODY),
      }),
    );
  });

  test('a failed run is reflected in the runs table outcome, not only on its own page', async ({
    page,
    context,
    request,
  }) => {
    const created = await createRun(request, { branch: 'feat/failed-in-table' });
    const runner = await registerRunner(request);
    const job = await claimJob(request, runner, ['playwright'], created.id);
    await completeJob(request, runner, job, {
      outcome: 'failed',
      summary: { total: 1, passed: 0, failed: 1 },
      tests: [
        {
          id: 'e2e-test-table-failure',
          title: 'fails in the table',
          file: 'b.spec.ts',
          status: 'failed',
          error: { code: 'ASSERTION_FAILED', message: 'table failure' },
        },
      ],
    });
    await waitForRunPhase(request, created.id, ['complete']);

    await authenticate(context, request);
    await signInAndVisit(page, '/dashboard/runs');

    // A row per run is asserted rather than the whole table, so a run pushed off
    // the first page by other tests cannot turn this into a vacuous pass or a
    // false failure.
    const row = page.getByTestId(`run-row-${created.id}`);
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId(`run-outcome-${created.id}`)).toHaveText('failed');
    await expect(page.getByTestId('stat-failed')).not.toHaveText('0');
  });
});
