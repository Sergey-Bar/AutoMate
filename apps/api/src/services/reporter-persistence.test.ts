/**
 * reporter-persistence.test.ts — `persistReporterEvent`, against a real
 * `RunRepository`.
 *
 * This is the persistence side of reporter ingestion: what it writes, what it
 * refuses, what it is idempotent about, and what it does when the row it is
 * patching is not there. The route tests drive it end to end, which means every
 * defect it had was visible only as "the dashboard numbers are wrong".
 *
 * The counter deltas get the most attention here. `runs.passed` and friends are
 * maintained by *adding to* the current value, which is what makes concurrent
 * increments safe — and also what makes a wrong delta permanent: there is no
 * recomputation, so a test that is counted twice is counted twice forever.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '@automate/db';
import { InMemoryRunRepository } from '../repositories/in-memory-run-repository.js';
import { DrizzleRunRepository } from '../repositories/drizzle-run-repository.js';
import type { RunRecord, TestRecord } from '../repositories/run-repository.js';
import type { NormalizedReporterEvent } from '../routes/reporter.js';
import { persistReporterEvent } from './reporter-persistence.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const RUN_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const TIMESTAMP = '2026-09-20T10:00:00.000Z';

function event(
  type: string,
  payload: unknown,
  overrides: Partial<NormalizedReporterEvent> = {},
): NormalizedReporterEvent {
  return { version: '1', type, runId: RUN_ID, timestamp: TIMESTAMP, payload, ...overrides };
}

/** Records every call, so "wrote nothing" is an assertion and not an absence. */
class RecordingRunRepository extends InMemoryRunRepository {
  readonly calls: string[] = [];

  override async upsertRun(run: RunRecord): Promise<void> {
    this.calls.push(`upsertRun(${run.id})`);
    await super.upsertRun(run);
  }

  override async patchRun(id: string, patch: Parameters<InMemoryRunRepository['patchRun']>[1]) {
    this.calls.push(`patchRun(${id}, ${JSON.stringify(patch)})`);
    await super.patchRun(id, patch);
  }

  override async upsertTest(test: TestRecord): Promise<void> {
    this.calls.push(`upsertTest(${test.id})`);
    await super.upsertTest(test);
  }

  override async patchTest(
    testId: string,
    runId: string,
    patch: Partial<Pick<TestRecord, 'status' | 'durationMs'>>,
  ): Promise<void> {
    this.calls.push(`patchTest(${testId}, ${runId}, ${JSON.stringify(patch)})`);
    await super.patchTest(testId, runId, patch);
  }

  override async getTest(testId: string, runId: string): Promise<TestRecord | null> {
    this.calls.push(`getTest(${testId}, ${runId})`);
    return super.getTest(testId, runId);
  }
}

async function started(
  repository: RecordingRunRepository,
  payload: Record<string, unknown> = {},
): Promise<void> {
  await persistReporterEvent(event('run:start', payload), repository);
}

async function began(
  repository: RecordingRunRepository,
  payload: Record<string, unknown> = {},
): Promise<void> {
  await persistReporterEvent(event('test:begin', payload), repository);
}

async function ended(
  repository: RecordingRunRepository,
  payload: Record<string, unknown>,
): Promise<boolean> {
  return persistReporterEvent(event('test:end', payload), repository);
}

// ---------------------------------------------------------------------------
// run:start
// ---------------------------------------------------------------------------

describe('run:start', () => {
  it('writes a running run with every counter at zero, and reports the write', async () => {
    const repository = new RecordingRunRepository();

    const runWritten = await persistReporterEvent(
      event('run:start', {
        total: 12,
        branch: 'main',
        commitSha: 'abc1234',
        triggeredBy: 'ci',
      }),
      repository,
    );

    expect(runWritten).toBe(true);
    // Counters start at zero rather than at `total`: a run that has started has run
    // no tests, and the counters only move through `test:end`.
    expect(await repository.getRun(RUN_ID)).toEqual({
      id: RUN_ID,
      startedAt: TIMESTAMP,
      finishedAt: null,
      status: 'running',
      total: 12,
      passed: 0,
      failed: 0,
      flaky: 0,
      skipped: 0,
      durationMs: null,
      branch: 'main',
      commitSha: 'abc1234',
      triggeredBy: 'ci',
    });
  });

  it('defaults the absent fields rather than writing undefined into a column', async () => {
    const repository = new RecordingRunRepository();

    await started(repository);

    expect(await repository.getRun(RUN_ID)).toMatchObject({
      total: 0,
      branch: null,
      commitSha: null,
      // Attributed to the reporter rather than to a person: nothing here knows who
      // started the run, and an empty string would read as a name.
      triggeredBy: 'reporter',
    });
  });

  it('is idempotent: a replayed start rewrites the row and leaves one run', async () => {
    const repository = new RecordingRunRepository();
    await started(repository, { total: 12 });
    await started(repository, { total: 20, branch: 'release/2.0' });

    const runs = await repository.listRuns();

    // One row, overwritten — not two, and not a counter incremented twice.
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ total: 20, branch: 'release/2.0' });
  });

  it('refuses a payload the schema rejects, and writes nothing', async () => {
    const repository = new RecordingRunRepository();

    for (const payload of [
      { total: -1 },
      { total: 1.5 },
      { total: 'twelve' },
      { branch: 42 },
      { commitSha: {} },
      { triggeredBy: [] },
      'not an object',
      null,
    ]) {
      const written = await persistReporterEvent(event('run:start', payload), repository);
      expect(written, JSON.stringify(payload)).toBe(false);
    }

    expect(repository.calls).toEqual([]);
    expect(await repository.listRuns()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// test:begin
// ---------------------------------------------------------------------------

describe('test:begin', () => {
  it('writes a running test and leaves the run alone, reporting no run write', async () => {
    const repository = new RecordingRunRepository();
    await started(repository, { total: 3 });
    const callsBefore = repository.calls.length;

    const runWritten = await persistReporterEvent(
      event('test:begin', {
        testId: 'test-1',
        title: 'logs in',
        file: 'e2e/auth/login.spec.ts',
      }),
      repository,
    );

    // False, deliberately: this is a test-only operation, and the caller uses the
    // signal to decide whether to broadcast a `run:updated` event. A test beginning
    // has not changed the run.
    expect(runWritten).toBe(false);
    // One write, and it is not a run write: the run counters are untouched by a test
    // that has only begun. Read before the assertions below, which call the store
    // themselves and would otherwise appear in this list.
    expect(repository.calls.slice(callsBefore)).toEqual(['upsertTest(test-1)']);
    expect(await repository.getTest('test-1', RUN_ID)).toEqual({
      id: 'test-1',
      runId: RUN_ID,
      title: 'logs in',
      file: 'e2e/auth/login.spec.ts',
      status: 'running',
      durationMs: null,
    });
    expect((await repository.getRun(RUN_ID))?.passed).toBe(0);
  });

  it('defaults an absent title and file rather than rejecting the event', async () => {
    const repository = new RecordingRunRepository();

    await persistReporterEvent(event('test:begin', { testId: 'test-1' }), repository);

    // The empty file stays empty. `path.normalize('')` is `'.'` on Node, so running
    // it through the traversal rule stored `.` as a spec file — and the dashboard's
    // suite grouping tests `file || 'unknown'`, so `'.'` is truthy and the test was
    // rendered as a suite called `.` rather than folded into the unknown one.
    expect(await repository.getTest('test-1', RUN_ID)).toMatchObject({ title: '', file: '' });
  });

  it('reduces a traversing file path to its basename before it is stored', async () => {
    const repository = new RecordingRunRepository();

    for (const file of [
      '../../etc/passwd',
      'e2e/../../../etc/shadow',
      '/etc/passwd',
      'report.json /../../etc/passwd',
    ]) {
      await persistReporterEvent(event('test:begin', { testId: 't', file }), repository);
      const stored = await repository.getTest('t', RUN_ID);
      expect(stored?.file, file).toBe(path.basename(path.normalize(file)));
      expect(stored?.file, file).not.toContain('..');
    }
  });

  it('keeps a legitimate spec path intact, so grouping by file still works', async () => {
    const repository = new RecordingRunRepository();

    await persistReporterEvent(
      event('test:begin', { testId: 't', file: 'e2e/auth/login.spec.ts' }),
      repository,
    );

    // The rule reduces on rejection and normalises on acceptance; a sanitiser that
    // mangled good paths would silently merge unrelated suites in the dashboard.
    expect((await repository.getTest('t', RUN_ID))?.file).toBe('e2e/auth/login.spec.ts');
  });

  it('refuses an event with no testId, and writes nothing', async () => {
    const repository = new RecordingRunRepository();

    for (const payload of [{}, { testId: '' }, { testId: 42 }, null]) {
      const written = await persistReporterEvent(event('test:begin', payload), repository);
      expect(written, JSON.stringify(payload)).toBe(false);
    }
    expect(repository.calls).toEqual([]);
  });

  it('is idempotent: a replayed begin rewrites the test row rather than adding one', async () => {
    const repository = new RecordingRunRepository();
    await began(repository, { testId: 'test-1', title: 'first title' });
    await began(repository, { testId: 'test-1', title: 'second title' });

    const stored = await repository.getAllTests();
    expect(stored).toHaveLength(1);
    expect(stored[0]?.title).toBe('second title');
  });
});

// ---------------------------------------------------------------------------
// test:end
// ---------------------------------------------------------------------------

describe('test:end', () => {
  it('stores the outcome and adds it to the run counter, and reports the run write', async () => {
    const repository = new RecordingRunRepository();
    await started(repository, { total: 2 });
    await began(repository, { testId: 'test-1' });

    const runWritten = await ended(repository, {
      testId: 'test-1',
      status: 'passed',
      durationMs: 1234,
    });

    expect(runWritten).toBe(true);
    expect(await repository.getTest('test-1', RUN_ID)).toMatchObject({
      status: 'passed',
      durationMs: 1234,
    });
    // A *delta*, not an assignment: the counters are incremented so two reporters
    // writing at once cannot clobber each other's totals.
    expect(repository.calls).toContain('patchRun(' + RUN_ID + ', {"passedDelta":1})');
    expect(await repository.getRun(RUN_ID)).toMatchObject({ passed: 1, failed: 0 });
  });

  it('records an absent duration as null rather than leaving the row half-written', async () => {
    const repository = new RecordingRunRepository();
    await began(repository, { testId: 'test-1' });

    await ended(repository, { testId: 'test-1', status: 'failed' });

    expect((await repository.getTest('test-1', RUN_ID))?.durationMs).toBeNull();
  });

  it('stores the one status spelling the tests column accepts', async () => {
    // Playwright emits `timedOut`; `tests_status_check` accepts only `timed_out`.
    // The write used to pass the camelCase spelling straight through, so a real
    // reporter upload hit the CHECK and came back as a classified failure — and a
    // row that had somehow been written read back as `unknown`, which no counter
    // counts.
    const repository = new RecordingRunRepository();
    await started(repository, { total: 1 });
    await began(repository, { testId: 'test-1' });

    await ended(repository, { testId: 'test-1', status: 'timedOut', durationMs: 30_000 });

    expect((await repository.getTest('test-1', RUN_ID))?.status).toBe('timed_out');
    // And it counts as the failure it is.
    expect(await repository.getRun(RUN_ID)).toMatchObject({ failed: 1, passed: 0 });
  });

  it('moves a counter when a test changes its mind, decrementing the old one', async () => {
    // A retried test goes `failed → passed`. Incrementing `passed` without
    // decrementing `failed` would leave the run reporting 2 tests when it has 1,
    // and the totals are the numbers a release is judged on.
    const repository = new RecordingRunRepository();
    await started(repository, { total: 1 });
    await began(repository, { testId: 'test-1' });
    await ended(repository, { testId: 'test-1', status: 'failed' });

    await ended(repository, { testId: 'test-1', status: 'passed' });

    expect(repository.calls).toContain(
      'patchRun(' + RUN_ID + ', {"passedDelta":1,"failedDelta":-1})',
    );
    expect(await repository.getRun(RUN_ID)).toMatchObject({ passed: 1, failed: 0 });
  });

  it('produces no delta when the reported outcome has not changed', async () => {
    // A reporter that re-sends `test:end` for a test it has already reported. The
    // second call must not count the test twice.
    const repository = new RecordingRunRepository();
    await started(repository, { total: 1 });
    await began(repository, { testId: 'test-1' });
    await ended(repository, { testId: 'test-1', status: 'passed' });
    const callsAfterFirst = repository.calls.length;

    await ended(repository, { testId: 'test-1', status: 'passed' });

    expect(repository.calls.slice(callsAfterFirst)).toEqual([
      'getTest(test-1, ' + RUN_ID + ')',
      'patchTest(test-1, ' + RUN_ID + ', {"status":"passed","durationMs":null})',
    ]);
    expect(await repository.getRun(RUN_ID)).toMatchObject({ passed: 1 });
  });

  it('produces no delta when neither the old nor the new status is an outcome', async () => {
    const repository = new RecordingRunRepository();
    await started(repository, { total: 1 });
    await began(repository, { testId: 'test-1' });

    await ended(repository, { testId: 'test-1', status: 'flaky' });
    const afterFirst = repository.calls.length;
    await ended(repository, { testId: 'test-1', status: 'skipped' });

    // flaky → skipped is a real change, and moves exactly one counter.
    expect(repository.calls.slice(afterFirst)).toContain(
      'patchRun(' + RUN_ID + ', {"flakyDelta":-1,"skippedDelta":1})',
    );
    expect(await repository.getRun(RUN_ID)).toMatchObject({ flaky: 0, skipped: 1 });
  });

  it('loses the outcome when the test row is not there, rather than inventing one', async () => {
    // The documented contract: `patchTest` on a missing row is a no-op. So a
    // `test:end` for a test whose `test:begin` was never delivered — a dropped
    // event, a reporter that started mid-run — is accepted, reported as a run
    // write, and stores nothing at all.
    //
    // It is stated here rather than hidden because the alternative is worse: the
    // run's counters stay correct, and the test is simply absent from the
    // dashboard, which reads as "never ran" rather than as "we lost it".
    const repository = new RecordingRunRepository();
    await started(repository, { total: 1 });

    const runWritten = await ended(repository, { testId: 'never-began', status: 'passed' });

    expect(runWritten).toBe(true);
    expect(await repository.getTest('never-began', RUN_ID)).toBeNull();
    // No counter moved: the delta is computed from the row that was not there.
    expect(await repository.getRun(RUN_ID)).toMatchObject({ passed: 0, total: 1 });
  });

  it('refuses a payload the schema rejects, and writes nothing', async () => {
    const repository = new RecordingRunRepository();
    await started(repository);
    await began(repository, { testId: 'test-1' });
    const callsBefore = repository.calls.length;

    for (const payload of [
      { testId: 'test-1', status: 'timed_out' },
      { testId: 'test-1', status: 'PASSED' },
      { testId: 'test-1', status: 'running' },
      { testId: 'test-1' },
      { status: 'passed' },
      { testId: 'test-1', status: 'passed', durationMs: 'quick' },
      null,
    ]) {
      const written = await persistReporterEvent(event('test:end', payload), repository);
      expect(written, JSON.stringify(payload)).toBe(false);
    }

    expect(repository.calls).toHaveLength(callsBefore);
    expect((await repository.getTest('test-1', RUN_ID))?.status).toBe('running');
  });
});

// ---------------------------------------------------------------------------
// run:end
// ---------------------------------------------------------------------------

describe('run:end', () => {
  it('closes the run with a status, a finish time and a duration', async () => {
    const repository = new RecordingRunRepository();
    await started(repository, { total: 1 });

    const runWritten = await persistReporterEvent(
      event('run:end', { status: 'passed', durationMs: 4200 }, { timestamp: 'later' }),
      repository,
    );

    expect(runWritten).toBe(true);
    expect(await repository.getRun(RUN_ID)).toMatchObject({
      status: 'passed',
      durationMs: 4200,
    });
    const stored = await repository.getRun(RUN_ID);
    // The finish time is stamped at the moment of the write, not taken from the
    // event: a reporter that replays its own events would otherwise overwrite a real
    // finish time with the start time it sent.
    expect(stored?.finishedAt).not.toBeNull();
    expect(stored?.startedAt).toBe(TIMESTAMP);
  });

  it('records an absent duration as null rather than leaving the previous one', async () => {
    const repository = new RecordingRunRepository();
    await started(repository);
    await persistReporterEvent(event('run:end', { status: 'failed', durationMs: 100 }), repository);

    await persistReporterEvent(event('run:end', { status: 'interrupted' }), repository);

    expect((await repository.getRun(RUN_ID))?.durationMs).toBeNull();
  });

  it('refuses a status the runs column does not store, and writes nothing', async () => {
    const repository = new RecordingRunRepository();
    await started(repository);
    const callsBefore = repository.calls.length;

    for (const status of ['queued', 'timed_out', 'PASSED', '', 42]) {
      const written = await persistReporterEvent(event('run:end', { status }), repository);
      expect(written, String(status)).toBe(false);
    }

    expect(repository.calls).toHaveLength(callsBefore);
    expect((await repository.getRun(RUN_ID))?.status).toBe('running');
  });
});

// ---------------------------------------------------------------------------
// The other event types
// ---------------------------------------------------------------------------

describe('event types this layer does not persist', () => {
  it('accepts and writes nothing for step, stdout, stderr and unknown types', async () => {
    const repository = new RecordingRunRepository();

    for (const type of [
      'step:begin',
      'step:end',
      'stdout',
      'stderr',
      'screenshot',
      'check.completed',
      '',
    ]) {
      const written = await persistReporterEvent(event(type, { anything: true }), repository);
      expect(written, type).toBe(false);
    }

    // Accepted by the route layer, deliberately not stored in this slice. A write
    // here would be a second, unreviewed persistence path.
    expect(repository.calls).toEqual([]);
    expect(await repository.listRuns()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Against the real schema
// ---------------------------------------------------------------------------

const drizzleDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../packages/db/drizzle',
);

/**
 * The real migration graph, in journal order, as one script.
 *
 * The same reader `errors/db-error-classification.test.ts` uses, restated because
 * `tests/integration` is not a dependency of `apps/api`.
 */
function readMigrations(): string {
  const journal = JSON.parse(
    readFileSync(path.join(drizzleDirectory, 'meta', '_journal.json'), 'utf8'),
  ) as { entries: Array<{ idx: number; tag: string }> };
  return journal.entries
    .slice()
    .sort((left, right) => left.idx - right.idx)
    .map((entry) =>
      readFileSync(path.join(drizzleDirectory, `${entry.tag}.sql`), 'utf8')
        .split('--> statement-breakpoint')
        .map((statement) => statement.trim())
        .filter(Boolean)
        .join(';\n'),
    )
    .join(';\n');
}

describe('the values it writes, against the real schema', () => {
  const clients: PGlite[] = [];
  let client: PGlite;

  beforeAll(async () => {
    client = new PGlite();
    clients.push(client);
    await client.exec(readMigrations());
  });

  afterAll(async () => {
    await Promise.all(clients.map((open) => open.close()));
  });

  it('writes a whole reporting sequence the column constraints accept', async () => {
    const repository = new DrizzleRunRepository(drizzle(client, { schema }));

    await persistReporterEvent(
      event('run:start', { total: 3, branch: 'main', commitSha: 'abc1234', triggeredBy: 'ci' }),
      repository,
    );
    await persistReporterEvent(
      event('test:begin', { testId: 'test-1', title: 'passes', file: 'e2e/a.spec.ts' }),
      repository,
    );
    await persistReporterEvent(
      event('test:end', { testId: 'test-1', status: 'passed', durationMs: 100 }),
      repository,
    );
    await persistReporterEvent(
      event('test:begin', { testId: 'test-2', title: 'times out', file: 'e2e/b.spec.ts' }),
      repository,
    );
    // The spelling that used to violate `tests_status_check`.
    await persistReporterEvent(
      event('test:end', { testId: 'test-2', status: 'timedOut', durationMs: 30_000 }),
      repository,
    );
    await persistReporterEvent(
      event('test:begin', { testId: 'test-3', title: 'fails', file: 'e2e/c.spec.ts' }),
      repository,
    );
    await persistReporterEvent(
      event('test:end', { testId: 'test-3', status: 'failed', durationMs: 200 }),
      repository,
    );
    await persistReporterEvent(
      event('run:end', { status: 'failed', durationMs: 30_100 }),
      repository,
    );

    // Read back through the real SELECT, so a value the column refused could not be
    // reported as written.
    expect(await repository.getTest('test-2', RUN_ID)).toMatchObject({ status: 'timed_out' });
    expect(await repository.getRun(RUN_ID)).toMatchObject({
      status: 'failed',
      total: 3,
      passed: 1,
      failed: 2,
      flaky: 0,
      skipped: 0,
    });
  });

  it('stores the run and test rows in the columns the dashboard reads them from', async () => {
    const repository = new DrizzleRunRepository(drizzle(client, { schema }));

    expect(await repository.listTests(RUN_ID)).toHaveLength(3);
    const [first] = await repository.listTests(RUN_ID);
    // `file` survived the traversal rule and the round trip: the dashboard groups
    // suites on exactly this string.
    expect(first?.file).toBe('e2e/a.spec.ts');
  });
});
