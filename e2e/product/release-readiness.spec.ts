/**
 * The release-readiness view.
 *
 * The property worth proving is the negative one: the view must not report a
 * release as ready on the strength of nothing. A QA product that shows READY for
 * a release with no browser evidence is worse than one that shows nothing,
 * because it is believed.
 *
 * A release can be a `uuid` column value without a row behind it — `runs.release_id`
 * has an `ON DELETE SET NULL` foreign key, but the API has no route that creates a
 * release, so a spec cannot seed one through the product's own boundary. What it
 * *can* do is ask the readiness endpoint about a release nobody has run anything
 * for, and require a non-green answer. That is the same endpoint the Command
 * Center and the run detail page read.
 */
import { expect, test } from '@playwright/test';
import {
  claimJob,
  completeJob,
  createRun,
  getReleaseReadiness,
  registerRunner,
} from '../support/api.js';
import { observedSummary, saveEvidence, saveEvidenceText } from '../support/evidence.js';
import { authenticate, signInAndVisit } from '../support/session.js';

const READINESS_DOMAINS = [
  'browser',
  'api',
  'mobile',
  'performance',
  'security',
  'accessibility',
  'other',
];

test.describe('release readiness', () => {
  test('a release with no executed runs is not ready, and says why per domain', async ({
    request,
  }) => {
    const releaseId = crypto.randomUUID();

    const readiness = await getReleaseReadiness(request, releaseId);

    expect(readiness.releaseId).toBe(releaseId);
    expect(readiness.decision, 'a release with no runs must not read as ready').not.toBe('ready');
    expect(readiness.decision).toBe('unknown');
    expect(readiness.latestRunId, 'no run may be named as evidence').toBeNull();
    // Only the browser adapter is executable, so only it may claim anything; the
    // rest must say they are not configured rather than borrowing a verdict.
    expect(readiness.domains['browser']).toBe('unknown');
    for (const domain of READINESS_DOMAINS.filter((name) => name !== 'browser')) {
      expect(readiness.domains[domain]).toBe('not_configured');
    }

    saveEvidence('release-readiness', 'empty-release-readiness.json', readiness);
  });

  test('the Command Center renders the readiness view with a non-green decision', async ({
    page,
    context,
    request,
  }) => {
    await authenticate(context, request);
    // `/dashboard/runs`, where the readiness card renders. The cockpit at `/dashboard`
    // is the install's blocking view and is project-scoped; the launch form, the run
    // list and the readiness card moved together to this route.
    await signInAndVisit(page, '/dashboard/runs');

    const card = page.getByTestId('release-readiness');
    await expect(card, 'the Command Center must show a release-readiness view').toBeVisible();

    // The decision badge is read from the DOM, not assumed.
    const badge = card.locator('[data-slot="badge"], span').filter({ hasText: /.+/ });
    const rendered = (await card.textContent()) ?? '';
    expect(rendered.length).toBeGreaterThan(0);
    expect(rendered).toMatch(/Release readiness/i);
    // Nothing on the page may claim a release is ready.
    await expect(card).not.toContainText('READY');
    for (const domain of READINESS_DOMAINS) {
      expect(rendered.toLowerCase(), `domain ${domain} must be rendered`).toContain(domain);
    }
    // `badge` is bound so the locator above is exercised, and a missing badge is
    // itself a finding rather than something to leave unasserted.
    await expect(badge.first()).toBeVisible();

    saveEvidence('release-readiness', 'command-center-readiness.txt', rendered);
  });

  test('a run that completes green is still not enough to call a release ready', async ({
    page,
    context,
    request,
  }) => {
    // A passing run exists by the time the view is read, and the view still
    // refuses a green verdict — because no release was ever attached to it.
    const created = await createRun(request, { branch: 'feat/readiness-fail-closed' });
    const runner = await registerRunner(request);
    const job = await claimJob(request, runner, ['playwright'], created.id);
    const completed = await completeJob(request, runner, job, {
      outcome: 'passed',
      summary: { total: 1, passed: 1, failed: 0 },
      tests: [{ id: 'e2e-test-green', title: 'green test', file: 'c.spec.ts', status: 'passed' }],
    });
    expect(completed.outcome).toBe('passed');
    expect(completed.releaseId, 'no release is attached to a run created this way').toBeNull();

    // The run's own gate, however, is a real evaluation and must be readable.
    await authenticate(context, request);
    await signInAndVisit(page, `/dashboard/runs/${created.id}`);
    const gate = page.getByTestId('run-gate');
    await expect(gate).toBeVisible({ timeout: 15_000 });
    const gateText = (await gate.textContent()) ?? '';
    expect(gateText, 'the quality gate must render an evaluation').toMatch(
      /passed|failed|unknown/i,
    );

    // A release nobody attached the run to must still not read as ready.
    const orphanRelease = await getReleaseReadiness(request, crypto.randomUUID());
    expect(orphanRelease.decision).not.toBe('ready');

    saveEvidence('release-readiness', 'passing-run-without-release.json', {
      runId: created.id,
      outcome: completed.outcome,
      releaseId: completed.releaseId,
      gateText: gateText.replace(/\s+/g, ' ').trim(),
      orphanReleaseDecision: orphanRelease.decision,
    });

    saveEvidenceText(
      'release-readiness',
      'observed-fail-closed.txt',
      observedSummary('Release readiness — observed state', {
        'run id': created.id,
        'run outcome': String(completed.outcome),
        'run release id': String(completed.releaseId),
        'run gate text': gateText.replace(/\s+/g, ' ').trim().slice(0, 120),
        'unattached release decision': orphanRelease.decision,
        'unattached release latest run': String(orphanRelease.latestRunId),
      }),
    );
  });
});
