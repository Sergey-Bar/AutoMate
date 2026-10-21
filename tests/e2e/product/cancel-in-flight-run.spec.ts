/**
 * Cancelling a run while a job is in flight.
 *
 * "In flight" is the whole point: a cancel against a run that has never been
 * leased, or against one that already finished, exercises a different branch of
 * the state machine than the one a user hits when they click Cancel on a run
 * that is visibly running. So the spec leases the job through a real runner
 * first, and only then cancels.
 *
 * The assertion is made on the API *and* on the page, in that order. The API
 * check says the cancellation was persisted; the page check says the user is told.
 */
import { expect, test } from '@playwright/test';
import { cancelRun, claimJob, createRun, registerRunner, waitForRunPhase } from '../support/api.js';
import { observedSummary, saveEvidence, saveEvidenceText } from '../support/evidence.js';
import { authenticate, signInAndVisit } from '../support/session.js';

test.describe('cancelling an in-flight run', () => {
  test('a leased job is cancelled and the run stops rendering as running', async ({
    page,
    context,
    request,
  }) => {
    const created = await createRun(request, { branch: 'feat/cancel-in-flight' });
    const runner = await registerRunner(request);
    const job = await claimJob(request, runner, ['playwright'], created.id);
    expect(job.runId, 'the claim must take the run this spec created').toBe(created.id);

    // Leased means the run is genuinely in flight, not merely queued.
    const inFlight = await waitForRunPhase(request, created.id, [
      'assigned',
      'preparing',
      'running',
    ]);

    const cancelled = await cancelRun(request, created.id);
    expect(cancelled.phase, 'a cancelled run must not stay in an active phase').toBe('cancelled');
    expect(cancelled.outcome).toBe('cancelled');

    // The API stays cancelled: a second read proves the state was persisted
    // rather than merely returned by the cancel handler.
    const settled = await waitForRunPhase(request, created.id, ['cancelled']);
    expect(settled.outcome).toBe('cancelled');

    await authenticate(context, request);
    await signInAndVisit(page, `/dashboard/runs/${created.id}`);

    await expect(page.getByTestId('run-detail-page')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('run-phase')).toHaveText('cancelled');
    await expect(page.getByTestId('run-status')).toHaveText('CANCELLED');
    // A cancelled run offers Retry, not a second Cancel — the action that is no
    // longer possible must not still be on screen.
    await expect(page.getByTestId('cancel-run')).toHaveCount(0);
    await expect(page.getByTestId('retry-run')).toBeVisible();

    saveEvidence('cancel-in-flight', 'cancelled-run.json', {
      runId: created.id,
      jobId: job.jobId,
      leaseId: job.leaseId,
      fencingToken: job.fencingToken,
      phaseBeforeCancel: inFlight.phase,
      phaseAfterCancel: cancelled.phase,
      outcomeAfterCancel: cancelled.outcome,
    });

    saveEvidenceText(
      'cancel-in-flight',
      'observed-cancellation.txt',
      observedSummary('Cancel in flight — observed state', {
        'run id': created.id,
        'phase before cancel': inFlight.phase,
        'phase after cancel': settled.phase,
        'outcome after cancel': String(settled.outcome),
        'rendered phase': (await page.getByTestId('run-phase').textContent())?.trim() ?? '',
        'rendered status': (await page.getByTestId('run-status').textContent())?.trim() ?? '',
        'cancel button present': String(await page.getByTestId('cancel-run').count()),
      }),
    );
  });

  test('cancelling from the page persists through the API', async ({ page, context, request }) => {
    const created = await createRun(request, { branch: 'feat/cancel-from-page' });
    const runner = await registerRunner(request);
    const job = await claimJob(request, runner, ['playwright'], created.id);
    expect(job.runId).toBe(created.id);
    await waitForRunPhase(request, created.id, ['assigned', 'preparing', 'running']);

    await authenticate(context, request);
    await signInAndVisit(page, `/dashboard/runs/${created.id}`);

    const cancelButton = page.getByTestId('cancel-run');
    await expect(cancelButton, 'an in-flight run must offer Cancel').toBeVisible({
      timeout: 15_000,
    });
    await cancelButton.click();

    // The click is not the assertion. The API reading afterwards is: it proves
    // the cancellation reached durable storage and was not only a local render.
    const settled = await waitForRunPhase(request, created.id, ['cancelled']);
    expect(settled.outcome).toBe('cancelled');
    await expect(page.getByTestId('run-phase')).toHaveText('cancelled');
    await expect(page.getByTestId('run-status')).toHaveText('CANCELLED');

    saveEvidence('cancel-in-flight', 'cancelled-from-page.json', {
      runId: created.id,
      phase: settled.phase,
      outcome: settled.outcome,
    });
  });
});
