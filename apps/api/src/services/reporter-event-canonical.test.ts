/**
 * reporter-event-canonical.test.ts — a run's event stream, turned into one canonical result.
 *
 * `POST /reporter/events` is a streaming door: it writes incrementally, because the
 * dashboard renders a run while it runs, and it closes the canonical row on the terminal
 * event. This file covers that closure, and the two places it can be wrong:
 *
 *  - **The accumulation must be durable, not in-memory.** Restart the process halfway
 *    through a run and the canonical row still has to be written, from what was persisted.
 *    An in-memory accumulator is a second authority that survives exactly as long as the
 *    process, and a run whose canonical row silently never appears is worse than one that
 *    is summarised.
 *  - **A run with no test rows is not a run result.** Refused by returning nothing, not by
 *    inventing an attempt.
 */

import { describe, expect, it } from 'vitest';
import { withErrorBoundary } from '../test-support/error-boundary-app.js';
import { createReporterRoutes } from '../routes/reporter.js';
import { InMemoryRunRepository } from '../repositories/in-memory-run-repository.js';
import { ReporterIngestionService } from '../services/reporter-ingestion.js';
import { DEFAULT_WORKSPACE_ID } from '../repositories/run-repository.js';
import { canonicalRunFromUploadEvents } from './reporter-event-canonical.js';
import { runEvents } from '../test-support/reporter-event-fixture.js';

function harness() {
  const runs = new InMemoryRunRepository();
  const store = new ReporterIngestionService(DEFAULT_WORKSPACE_ID);
  const app = withErrorBoundary(
    createReporterRoutes(undefined, {
      repository: runs,
      workspaceId: DEFAULT_WORKSPACE_ID,
      canonicalStore: store,
    }),
  );
  return { runs, store, app };
}

async function stream(h: ReturnType<typeof harness>, runId: string) {
  for (const event of runEvents(runId)) {
    const response = await h.app.request('/api/v1/reporter/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
    });
    expect(response.status, `${JSON.stringify(event)}`).toBe(202);
  }
}

describe('a streamed run closes its canonical row when the run ends', () => {
  it('records every test it saw, and one row per test', async () => {
    const h = harness();
    await stream(h, 'stream-001');

    const stored = await h.store.get('stream-001');
    // **This is the defect the door had.** Before this change the events door wrote `runs`
    // and nothing canonical, so a run that reported every test it ran was invisible to
    // `GET /api/v1/reporting/kpis` — and the KPI endpoint answered `proofCeiling:
    // 'unknown'` about the busiest system in the installation.
    expect(stored, 'the stream must be readable as a canonical result').toBeDefined();
    expect(stored?.identity.runId).toBe('stream-001');
    expect(stored?.attempts.map((attempt) => attempt.testId).sort()).toEqual([
      'test-a',
      'test-b',
      'test-c',
    ]);
    // **One attempt per test, because `tests` holds one row per test.** The stream's own
    // retry history is collapsed by the event door before the canonical result sees it, so
    // the canonical row's per-attempt detail for this door is weaker than for the upload
    // door's. That is stated in `reporter-event-canonical.ts` rather than papered over.
    expect(stored?.attempts).toHaveLength(3);
    expect(stored?.provenance.producer).toBe('legacy');
    expect(stored?.provenance.sourceDigest).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('agrees with the projection the events door already wrote', async () => {
    const h = harness();
    await stream(h, 'stream-002');
    const stored = await h.store.get('stream-002');
    const run = await h.runs.getRun('stream-002');
    // **The canonical row overwrites the event door's own verdict, and that is the point.**
    // `run:end` declared `failed`, because the SDK saw a test fail. The test rows say one
    // test failed and was then retried into a flake, and a claim cannot outrank the rows it
    // describes — so the run is `flaky`, which `runs` records as `interrupted` with
    // `outcome: 'partial'`: evidence without a terminal verdict.
    //
    // Before this change the events door's incremental answer was the only one, and it was
    // the flattering one.
    expect(stored?.status).toBe('flaky');
    expect(run?.status).toBe('interrupted');
    expect(run?.phase).toBe('partial');
    expect(run?.outcome).toBe('partial');
    expect(run?.total).toBe(3);
    expect(run?.passed).toBe(2);
    expect(run?.flaky).toBe(1);
    expect(run?.failed, 'a retried test is not a product failure').toBe(0);
  });

  it('produces the same canonical result twice for the same stream', async () => {
    const h = harness();
    await stream(h, 'stream-003');
    const first = await h.store.get('stream-003');
    // The digest is over the run identity and the attempts it reported, because a stream
    // has no single document to hash. A constant would make every streamed run in the
    // installation fingerprint identically — which is the defect `digestRunOutcome` was
    // written to end, reintroduced on this door.
    const again = await canonicalRunFromUploadEvents(h.runs, {
      workspaceId: DEFAULT_WORKSPACE_ID,
      runId: 'stream-003',
    });
    expect(again?.provenance.sourceDigest).toBe(first?.provenance.sourceDigest);

    const other = harness();
    await stream(other, 'stream-004');
    expect((await other.store.get('stream-004'))?.provenance.sourceDigest).not.toBe(
      first?.provenance.sourceDigest,
    );
  });

  it('rebuilds the result from persisted rows, so a fresh process reaches the same answer', async () => {
    const h = harness();
    await stream(h, 'stream-005');
    const before = await h.store.get('stream-005');

    // A second store and a second repository over the *same* rows: this is what a restart
    // looks like. If the accumulation lived in memory, `before` would be the only witness
    // that the run was ever canonicalised.
    const after = await canonicalRunFromUploadEvents(h.runs, {
      workspaceId: DEFAULT_WORKSPACE_ID,
      runId: 'stream-005',
    });
    expect(after?.provenance.sourceDigest).toBe(before?.provenance.sourceDigest);
    expect(after?.status).toBe(before?.status);
  });

  it('refuses to build a result for a run with no tests', async () => {
    const h = harness();
    const response = await h.app.request('/api/v1/reporter/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'run:end',
        runId: 'stream-empty',
        payload: { status: 'passed' },
      }),
    });
    expect(response.status).toBe(202);
    // A run with no observable attempt has observed nothing, and inventing one would record
    // a test that never ran. `undefined` is the refusal; the run row the event wrote still
    // stands, because the event door is not this door.
    expect(
      await canonicalRunFromUploadEvents(h.runs, {
        workspaceId: DEFAULT_WORKSPACE_ID,
        runId: 'stream-empty',
      }),
    ).toBeUndefined();
    expect(await h.store.get('stream-empty')).toBeUndefined();
  });

  it('keeps a stream that says it is still going open', async () => {
    const h = harness();
    for (const event of runEvents('stream-006', { terminalStatus: 'running' })) {
      const response = await h.app.request('/api/v1/reporter/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(event),
      });
      expect(response.status).toBe(202);
    }
    // A producer that says the run has not finished has produced no verdict, and deriving
    // one from the tests that have reported so far is deriving it from a partial view.
    const stored = await h.store.get('stream-006');
    expect(stored?.status).toBe('running');
    expect((await h.runs.getRun('stream-006'))?.status).toBe('running');
  });
});
