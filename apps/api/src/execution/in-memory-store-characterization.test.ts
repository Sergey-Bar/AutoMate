import { describe, expect, it } from 'vitest';
import { InMemoryExecutionStore } from './in-memory-execution-store.js';
import type { ExecutionEventInput, JobClaim } from './types.js';

/**
 * Characterization of the in-memory store's event, completion and lease paths.
 *
 * These were written against the code as it stood before `appendEvents`,
 * `applyEventToRun`, `completeJob` and `reapExpiredLeases` were split into named helpers
 * (Q-1 clause (a)), so each assertion is what the store did, not what a refactor would like it
 * to have done. They drive the public store methods only: a helper extracted from a private
 * method is covered by the behaviour that reaches it.
 */
const WS = 'ws-char';
const START = Date.parse('2026-03-01T00:00:00.000Z');

interface Fixture {
  store: InMemoryExecutionStore;
  clock: { ms: number };
  runId: string;
  claim: JobClaim;
}

async function setup(runInput: Record<string, unknown> = {}, key = 'k1'): Promise<Fixture> {
  const clock = { ms: START };
  const store = new InMemoryExecutionStore({
    now: () => new Date(clock.ms),
    leaseDurationMs: 60_000,
  });
  await store.registerRunner(
    {
      id: 'r1',
      name: 'r1',
      version: '1',
      os: 'linux',
      arch: 'x64',
      capabilities: ['playwright'],
      labels: [],
      slots: 2,
    },
    'hash-r1',
    new Date(START + 3_600_000).toISOString(),
  );
  const { run } = await store.createRun(runInput, key, WS);
  const claim = (await store.claimJob('r1', [], [], undefined, WS)) as JobClaim;
  return { store, clock, runId: run.id, claim };
}

function ev(
  eventId: string,
  sequence: number,
  type: string,
  payload?: Record<string, unknown>,
): ExecutionEventInput {
  return payload === undefined ? { eventId, sequence, type } : { eventId, sequence, type, payload };
}

async function append(f: Fixture, events: ExecutionEventInput[], workspaceId?: string) {
  return f.store.appendEvents(
    f.claim.jobId,
    f.claim.leaseId,
    f.claim.fencingToken,
    events,
    workspaceId,
  );
}

describe('appendEvents: lease and batch validation', () => {
  it('refuses every event of the batch when the job is unknown', async () => {
    const f = await setup();
    const results = await f.store.appendEvents('nope', 'l', 1, [
      ev('a', 1, 'custom'),
      ev('b', 2, 'custom'),
    ]);
    expect(results).toEqual([
      { eventId: 'a', sequence: 1, status: 'conflict', reason: 'stale_lease' },
      { eventId: 'b', sequence: 2, status: 'conflict', reason: 'stale_lease' },
    ]);
  });

  it('refuses a batch for another workspace, a wrong lease id and a wrong fencing token', async () => {
    const f = await setup();
    const stale = [{ eventId: 'a', sequence: 1, status: 'conflict', reason: 'stale_lease' }];
    expect(await append(f, [ev('a', 1, 'custom')], 'other')).toEqual(stale);
    expect(
      await f.store.appendEvents(f.claim.jobId, 'wrong', f.claim.fencingToken, [
        ev('a', 1, 'custom'),
      ]),
    ).toEqual(stale);
    expect(
      await f.store.appendEvents(f.claim.jobId, f.claim.leaseId, f.claim.fencingToken + 1, [
        ev('a', 1, 'custom'),
      ]),
    ).toEqual(stale);
  });

  it('refuses a batch once the lease has expired, including at the exact expiry instant', async () => {
    const f = await setup();
    f.clock.ms = START + 60_000;
    expect(await append(f, [ev('a', 1, 'custom')])).toEqual([
      { eventId: 'a', sequence: 1, status: 'conflict', reason: 'stale_lease' },
    ]);
  });

  it.each([
    ['empty id', ev('', 1, 'custom')],
    ['zero sequence', ev('a', 0, 'custom')],
    ['fractional sequence', ev('a', 1.5, 'custom')],
  ])('rejects the whole batch with invalid_event for %s', async (_name, bad) => {
    const f = await setup();
    const results = await append(f, [ev('ok', 1, 'custom'), bad]);
    expect(results).toEqual([
      { eventId: bad.eventId, sequence: bad.sequence, status: 'conflict', reason: 'invalid_event' },
    ]);
    // Nothing from the refused batch was stored.
    expect((await f.store.listEvents(WS, f.runId)).events).toEqual([]);
  });

  it('accepts a sequence in order and acknowledges a replay as a duplicate with the same hash', async () => {
    const f = await setup();
    const first = await append(f, [ev('a', 1, 'custom', { x: 1 }), ev('b', 2, 'custom')]);
    expect(first.map((r) => [r.eventId, r.sequence, r.status])).toEqual([
      ['a', 1, 'accepted'],
      ['b', 2, 'accepted'],
    ]);
    const replay = await append(f, [ev('a', 1, 'custom', { x: 1 }), ev('c', 3, 'custom')]);
    expect(replay.map((r) => [r.eventId, r.status])).toEqual([
      ['a', 'duplicate'],
      ['c', 'accepted'],
    ]);
    expect(replay[0]?.hash).toBe(first[0]?.hash);
    expect((await f.store.listEvents(WS, f.runId)).events.map((e) => e.eventId)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('reports event_hash_mismatch for a reused id with different content', async () => {
    const f = await setup();
    await append(f, [ev('a', 1, 'custom', { x: 1 })]);
    expect(await append(f, [ev('a', 1, 'custom', { x: 2 })])).toEqual([
      { eventId: 'a', sequence: 1, status: 'conflict', reason: 'event_hash_mismatch' },
    ]);
  });

  it('reports sequence_gap for a new event that skips ahead, and stores nothing from the batch', async () => {
    const f = await setup();
    expect(await append(f, [ev('a', 1, 'custom'), ev('b', 3, 'custom')])).toEqual([
      { eventId: 'b', sequence: 3, status: 'conflict', reason: 'sequence_gap' },
    ]);
    expect((await f.store.listEvents(WS, f.runId)).events).toEqual([]);
  });

  it('reports terminal_event for a correctly sequenced event after run.completed', async () => {
    const f = await setup();
    await append(f, [ev('done', 1, 'run.completed', { phase: 'complete', outcome: 'passed' })]);
    expect(await append(f, [ev('late', 2, 'custom')])).toEqual([
      { eventId: 'late', sequence: 2, status: 'conflict', reason: 'terminal_event' },
    ]);
  });

  it('reports terminal_event, not sequence_gap, for an out-of-sequence event after the run ended (as the PostgreSQL store does)', async () => {
    const f = await setup();
    await append(f, [ev('done', 1, 'run.completed', { phase: 'complete', outcome: 'passed' })]);
    expect(await append(f, [ev('late', 5, 'custom')])).toEqual([
      { eventId: 'late', sequence: 5, status: 'conflict', reason: 'terminal_event' },
    ]);
    // Before the run ends the same skip is still a gap.
    const g = await setup({}, 'k2');
    expect(await append(g, [ev('skip', 5, 'custom')])).toEqual([
      { eventId: 'skip', sequence: 5, status: 'conflict', reason: 'sequence_gap' },
    ]);
  });

  it('treats a custom event carrying payload.terminal as terminal, within one batch and across batches', async () => {
    const f = await setup();
    expect(
      await append(f, [ev('t', 1, 'custom', { terminal: true }), ev('after', 2, 'custom')]),
    ).toEqual([{ eventId: 'after', sequence: 2, status: 'conflict', reason: 'terminal_event' }]);
    const g = await setup({}, 'k2');
    await append(g, [ev('t', 1, 'custom', { terminal: true })]);
    expect(await append(g, [ev('after', 2, 'custom')])).toEqual([
      { eventId: 'after', sequence: 2, status: 'conflict', reason: 'terminal_event' },
    ]);
  });

  it('stamps accepted events with receipt time, the lease and the run, and defaults occurredAt', async () => {
    const f = await setup();
    await append(f, [
      ev('a', 1, 'custom'),
      { eventId: 'b', sequence: 2, type: 'custom', occurredAt: '2026-01-01T00:00:00.000Z' },
    ]);
    const [a, b] = (await f.store.listEvents(WS, f.runId)).events;
    expect(a).toMatchObject({
      runId: f.runId,
      jobId: f.claim.jobId,
      leaseId: f.claim.leaseId,
      fencingToken: f.claim.fencingToken,
      receivedAt: new Date(START).toISOString(),
      occurredAt: new Date(START).toISOString(),
      payload: {},
    });
    expect(b?.occurredAt).toBe('2026-01-01T00:00:00.000Z');
  });
});

describe('appendEvents: how events fold into the run', () => {
  it('applies a phase event and ignores unknown phases', async () => {
    const f = await setup();
    await append(f, [ev('p', 1, 'run.phase', { phase: 'running' })]);
    expect(await f.store.getRun(f.runId)).toMatchObject({ phase: 'running', outcome: null });
    await append(f, [ev('q', 2, 'run.started', { phase: 'not-a-phase' })]);
    expect(await f.store.getRun(f.runId)).toMatchObject({ phase: 'running' });
  });

  it('records completion time for a terminal phase', async () => {
    const f = await setup();
    await append(f, [ev('p', 1, 'run.phase_changed', { phase: 'cancelled' })]);
    const run = await f.store.getRun(f.runId);
    expect(run?.phase).toBe('cancelled');
    expect(run?.completedAt).toBe(new Date(START).toISOString());
  });

  it('adds a started test, then marks the same id running again without duplicating it', async () => {
    const f = await setup();
    await append(f, [
      ev('s1', 1, 'test.started', { testId: 't1', title: 'First', file: 'a.spec.ts' }),
      ev('s2', 2, 'test.started', { id: 't2' }),
      ev('s3', 3, 'test.started', { testId: 't1' }),
      ev('s4', 4, 'test.started', {}),
    ]);
    const run = await f.store.getRun(f.runId);
    expect(run?.tests).toEqual([
      {
        id: 't1',
        title: 'First',
        file: 'a.spec.ts',
        stableId: 'a.spec.ts › First',
        status: 'running',
      },
      { id: 't2', title: 't2', file: null, stableId: ' › t2', status: 'running' },
    ]);
    expect(run?.summary.total).toBe(2);
  });

  it('completes an existing test, keeping its duration unless a new one is reported', async () => {
    const f = await setup();
    await append(f, [
      ev('s1', 1, 'test.started', { testId: 't1' }),
      ev('c1', 2, 'test.completed', { testId: 't1', status: 'passed', durationMs: 12 }),
      ev('c2', 3, 'test.completed', { testId: 't1', status: 'failed', error: 'boom' }),
    ]);
    const run = await f.store.getRun(f.runId);
    expect(run?.tests).toEqual([
      {
        id: 't1',
        title: 't1',
        file: null,
        stableId: ' › t1',
        status: 'failed',
        durationMs: 12,
        error: { code: 'EXECUTION_ERROR', message: 'boom' },
      },
    ]);
  });

  it('creates a test from a completion alone and normalises status and error shapes', async () => {
    const f = await setup();
    await append(f, [
      ev('c1', 1, 'test.completed', { testId: 'a', status: 'timed_out', durationMs: 5 }),
      ev('c2', 2, 'test.completed', { id: 'b', status: 'bogus', file: 'f.ts', title: 'B' }),
      ev('c3', 3, 'test.completed', {
        id: 'c',
        status: 'flaky',
        error: { code: 'E1', message: 'm' },
      }),
      ev('c4', 4, 'test.completed', { id: 'd', status: 'skipped', error: { code: 3 } }),
      ev('c5', 5, 'test.completed', { id: 'e', status: 'running', error: 7 }),
      ev('c6', 6, 'test.completed', { status: 'passed' }),
    ]);
    const run = await f.store.getRun(f.runId);
    expect(run?.tests).toEqual([
      {
        id: 'a',
        title: 'a',
        file: null,
        stableId: ' › a',
        status: 'timed_out',
        durationMs: 5,
        error: null,
      },
      {
        id: 'b',
        title: 'B',
        file: 'f.ts',
        stableId: 'f.ts › B',
        status: 'unknown',
        durationMs: null,
        error: null,
      },
      {
        id: 'c',
        title: 'c',
        file: null,
        stableId: ' › c',
        status: 'flaky',
        durationMs: null,
        error: { code: 'E1', message: 'm' },
      },
      {
        id: 'd',
        title: 'd',
        file: null,
        stableId: ' › d',
        status: 'skipped',
        durationMs: null,
        error: { code: 'EXECUTION_ERROR', message: 'Execution failed' },
      },
      {
        id: 'e',
        title: 'e',
        file: null,
        stableId: ' › e',
        status: 'running',
        durationMs: null,
        error: null,
      },
    ]);
  });

  it('folds run.completed: summary numbers override only when numeric, outcome from payload', async () => {
    const f = await setup();
    await append(f, [
      ev('t1', 1, 'test.completed', { testId: 'a', status: 'passed' }),
      ev('done', 2, 'run.completed', {
        phase: 'complete',
        outcome: 'passed',
        summary: { total: 4, passed: 'many', failed: 1, durationMs: 99 },
        error: 'late',
      }),
    ]);
    const run = await f.store.getRun(f.runId);
    expect(run).toMatchObject({
      phase: 'complete',
      outcome: 'passed',
      completedAt: new Date(START).toISOString(),
      error: { code: 'EXECUTION_ERROR', message: 'late' },
    });
    expect(run?.summary).toMatchObject({ total: 4, passed: 1, failed: 1, durationMs: 99 });
  });

  it('folds run.completed without a summary, taking the outcome from payload.status and defaulting the phase', async () => {
    const f = await setup();
    await append(f, [ev('done', 1, 'run.completed', { status: 'failed' })]);
    const run = await f.store.getRun(f.runId);
    expect(run).toMatchObject({ phase: 'complete', outcome: 'failed', status: 'failed' });
  });

  it('ignores a null or non-object summary on run.completed', async () => {
    const f = await setup();
    await append(f, [ev('done', 1, 'run.completed', { outcome: 'failed', summary: null })]);
    expect((await f.store.getRun(f.runId))?.summary.total).toBe(0);
    const g = await setup({}, 'k2');
    await append(g, [ev('done', 1, 'run.completed', { outcome: 'failed', summary: 'x' })]);
    expect((await g.store.getRun(g.runId))?.summary.total).toBe(0);
  });
});

describe('completeJob', () => {
  const done = (f: Fixture, extra: Record<string, unknown> = {}) => ({
    leaseId: f.claim.leaseId,
    fencingToken: f.claim.fencingToken,
    ...extra,
  });

  it('returns null for an unknown job, a foreign workspace, a wrong lease, a wrong token and an expired lease', async () => {
    const f = await setup();
    expect(await f.store.completeJob('nope', done(f))).toBeNull();
    expect(await f.store.completeJob(f.claim.jobId, done(f), 'other')).toBeNull();
    expect(await f.store.completeJob(f.claim.jobId, done(f, { leaseId: 'x' }))).toBeNull();
    expect(await f.store.completeJob(f.claim.jobId, done(f, { fencingToken: 99 }))).toBeNull();
    f.clock.ms = START + 60_000;
    expect(await f.store.completeJob(f.claim.jobId, done(f))).toBeNull();
  });

  it('accepts a passing completion, then answers a byte-identical replay as duplicate and a different one as null', async () => {
    const f = await setup();
    const completion = done(f, { status: 'passed', summary: { total: 1, passed: 1 } });
    const first = await f.store.completeJob(f.claim.jobId, completion);
    expect(first?.status).toBe('accepted');
    expect(first?.run).toMatchObject({ phase: 'complete', outcome: 'passed', status: 'passed' });
    expect(first?.job).toMatchObject({ state: 'completed', leaseExpiresAt: null, error: null });
    expect((await f.store.completeJob(f.claim.jobId, completion))?.status).toBe('duplicate');
    expect(await f.store.completeJob(f.claim.jobId, done(f, { status: 'failed' }))).toBeNull();
  });

  it('maps failure statuses to job states and error codes', async () => {
    const failed = await setup();
    const result = await failed.store.completeJob(
      failed.claim.jobId,
      done(failed, { status: 'failed', error: { message: 'bad' } }),
    );
    expect(result?.job).toMatchObject({
      state: 'failed',
      error: { code: 'EXECUTION_ERROR', message: 'bad' },
    });
    expect(result?.run).toMatchObject({
      outcome: 'failed',
      error: { code: 'EXECUTION_ERROR', message: 'bad' },
    });

    const cancelled = await setup({}, 'k2');
    const c = await cancelled.store.completeJob(
      cancelled.claim.jobId,
      done(cancelled, { status: 'cancelled', error: { code: 'X', message: 'stop' } }),
    );
    expect(c?.job.state).toBe('cancelled');
    expect(c?.run).toMatchObject({ phase: 'cancelled', error: { code: 'X', message: 'stop' } });

    const cleared = await setup({}, 'k3');
    const n = await cleared.store.completeJob(
      cleared.claim.jobId,
      done(cleared, { status: 'passed', error: null }),
    );
    expect(n?.run.error).toBeNull();
    expect(n?.job.error).toBeNull();
  });

  it('replaces the tests when the completion carries them', async () => {
    const f = await setup();
    const result = await f.store.completeJob(
      f.claim.jobId,
      done(f, {
        status: 'passed',
        tests: [{ id: 't', title: 't', file: null, status: 'passed' }],
      }),
    );
    expect(result?.run.tests).toHaveLength(1);
    expect(result?.run.summary.total).toBe(1);
  });

  it.each([
    ['passed', 'passed'],
    ['failed', 'failed'],
    ['partial', 'warning'],
    ['cancelled', 'unknown'],
  ])('tells the quality gate the browser domain is %s -> %s', async (outcome, domain) => {
    const f = await setup();
    await f.store.completeJob(
      f.claim.jobId,
      done(f, { status: outcome, outcome, summary: { total: 1, passed: 1 } }),
    );
    const gate = await f.store.getGate(WS, f.runId);
    expect(JSON.stringify(gate)).toContain(domain);
  });
});

describe('reapExpiredLeases', () => {
  it('leaves a live lease alone', async () => {
    const f = await setup();
    f.clock.ms = START + 59_999;
    expect(await f.store.reapExpiredLeases()).toEqual([]);
  });

  it('requeues an expired lease while attempts remain and the run is not terminal', async () => {
    const f = await setup();
    f.clock.ms = START + 60_000;
    const results = await f.store.reapExpiredLeases();
    expect(results).toEqual([
      { jobId: f.claim.jobId, runId: f.runId, requeued: true, phase: 'queued', status: 'queued' },
    ]);
    const run = await f.store.getRun(f.runId);
    expect(run).toMatchObject({
      attempt: 2,
      phase: 'queued',
      outcome: null,
      status: 'queued',
      runner: null,
      error: { code: 'RUNNER_LOST', message: 'Runner lease expired; job requeued' },
    });
    expect(await f.store.getJob(f.claim.jobId)).toMatchObject({
      state: 'queued',
      attempt: 2,
      leaseId: null,
      leaseOwner: null,
      leaseExpiresAt: null,
      heartbeatAt: null,
      error: { code: 'RUNNER_LOST', message: 'Runner lease expired' },
    });
  });

  it('fails the job as runner_lost once the third attempt is lost', async () => {
    const f = await setup();
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      f.clock.ms += 60_000;
      expect((await f.store.reapExpiredLeases())[0]?.requeued).toBe(true);
      expect(await f.store.claimJob('r1', [], [], undefined, WS)).not.toBeNull();
    }
    f.clock.ms += 60_000;
    const results = await f.store.reapExpiredLeases();
    expect(results).toEqual([
      {
        jobId: f.claim.jobId,
        runId: f.runId,
        requeued: false,
        phase: 'runner_lost',
        status: 'failed',
      },
    ]);
    expect(await f.store.getRun(f.runId)).toMatchObject({
      phase: 'runner_lost',
      outcome: 'runner_lost',
      status: 'runner_lost',
      error: { code: 'RUNNER_LOST', message: 'Runner lease expired' },
      runner: null,
    });
    expect((await f.store.getJob(f.claim.jobId))?.state).toBe('failed');
  });

  it('does not requeue a run that has already reached a terminal phase', async () => {
    const f = await setup();
    await append(f, [ev('p', 1, 'run.phase', { phase: 'cancelled' })]);
    f.clock.ms = START + 60_000;
    const results = await f.store.reapExpiredLeases();
    expect(results[0]).toMatchObject({ requeued: false, status: 'failed', phase: 'runner_lost' });
  });
});
