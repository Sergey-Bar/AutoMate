/**
 * tests.test.ts — the three read routes that answer with test records:
 *
 *   GET /api/v1/dashboard/tests              — every test, across every run
 *   GET /api/v1/dashboard/suites             — summaries grouped by test file
 *   GET /api/v1/dashboard/runs/:runId/tests  — one run's tests
 *
 * All three live in `tests.ts`, not in a file per noun: `/suites` and
 * `/runs/:runId/tests` are aggregations of the same `listTests` call. The
 * `/suites` pass rate is the arithmetic most likely to be quietly wrong, so it is
 * asserted from real rows rather than from a single round number.
 */
import { describe, expect, it } from 'vitest';
/**
 * The boundary's body, named.
 *
 * A cast to `Record<string, unknown>` can read any shape and so checks none, which is
 * how `body.error` stayed a bare string in this suite after the migration: the
 * assertion was satisfied by a field that no longer exists.
 */
import { withErrorBoundary } from '../../test-support/error-boundary-app.js';
import { Hono } from 'hono';
import { InMemoryRunRepository } from '../../repositories/in-memory-run-repository.js';
import type { RunRecord, TestRecord } from '../../repositories/run-repository.js';
import { createDashboardTestsRoutes } from './tests.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeRun(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    id: 'run-a',
    startedAt: '2026-09-20T10:00:00.000Z',
    finishedAt: '2026-09-20T10:05:00.000Z',
    status: 'passed',
    total: 2,
    passed: 2,
    failed: 0,
    flaky: 0,
    skipped: 0,
    durationMs: 300_000,
    branch: 'main',
    commitSha: 'abc1234',
    triggeredBy: 'ci',
    ...overrides,
  };
}

function makeTest(overrides: Partial<TestRecord> = {}): TestRecord {
  return {
    id: 'test-1',
    runId: 'run-a',
    title: 'logs in',
    file: 'e2e/auth/login.spec.ts',
    status: 'passed',
    durationMs: 1200,
    ...overrides,
  };
}

/**
 * A `RunRepository` that refuses to disclose another workspace's runs.
 *
 * `RunRepository` carries no workspace — see `runs.test.ts`, which records that
 * gap — so this is the shape a store has to have for `WORKSPACE_ID` to be a
 * boundary at all. With it, the collection routes can be asked whether a foreign
 * row reaches the caller.
 */
class WorkspaceScopedRunRepository extends InMemoryRunRepository {
  private readonly _foreign = new Set<string>();

  markForeign(runId: string): void {
    this._foreign.add(runId);
  }

  override async getRun(id: string): Promise<RunRecord | null> {
    return this._foreign.has(id) ? null : super.getRun(id);
  }

  override async listRuns(): Promise<RunRecord[]> {
    return (await super.listRuns()).filter((run) => !this._foreign.has(run.id));
  }

  override async listTests(runId: string): Promise<TestRecord[]> {
    return this._foreign.has(runId) ? [] : super.listTests(runId);
  }
}

function mount(repository: InMemoryRunRepository): Hono {
  return withErrorBoundary(createDashboardTestsRoutes({ repository }));
}

// ---------------------------------------------------------------------------
// GET /api/v1/dashboard/tests
// ---------------------------------------------------------------------------

describe('GET /api/v1/dashboard/tests', () => {
  it('returns every test across every run, each with its own runId', async () => {
    const repository = new InMemoryRunRepository();
    await repository.upsertRun(makeRun({ id: 'run-a' }));
    await repository.upsertRun(makeRun({ id: 'run-b' }));
    await repository.upsertTest(makeTest({ id: 'a1', runId: 'run-a' }));
    await repository.upsertTest(makeTest({ id: 'b1', runId: 'run-b', title: 'signs up' }));
    const app = mount(repository);

    const response = await app.request('/api/v1/dashboard/tests');

    expect(response.status).toBe(200);
    const body = (await response.json()) as Array<Record<string, unknown>>;
    expect(body.map((test) => [test['id'], test['runId']])).toEqual([
      ['a1', 'run-a'],
      ['b1', 'run-b'],
    ]);
  });

  it('returns an empty array, not 404, when nothing has been ingested', async () => {
    const response = await mount(new InMemoryRunRepository()).request('/api/v1/dashboard/tests');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
  });

  it('carries the full test record, including a null duration', async () => {
    // A test that has begun but not ended has no duration. `null` and a missing
    // field mean different things to a caller rendering a trend.
    const repository = new InMemoryRunRepository();
    await repository.upsertRun(makeRun({ id: 'run-a' }));
    await repository.upsertTest(makeTest({ id: 'a1', durationMs: null, status: 'running' }));
    const app = mount(repository);

    const body = (await (await app.request('/api/v1/dashboard/tests')).json()) as Array<
      Record<string, unknown>
    >;

    expect(body[0]).toEqual({
      id: 'a1',
      runId: 'run-a',
      title: 'logs in',
      file: 'e2e/auth/login.spec.ts',
      status: 'running',
      durationMs: null,
    });
  });

  it("does not return another workspace run's tests", async () => {
    const repository = new WorkspaceScopedRunRepository();
    await repository.upsertRun(makeRun({ id: 'mine' }));
    await repository.upsertTest(makeTest({ id: 'mine-test', runId: 'mine' }));
    await repository.upsertRun(makeRun({ id: 'theirs' }));
    await repository.upsertTest(
      makeTest({ id: 'their-test', runId: 'theirs', title: 'their secret test' }),
    );
    repository.markForeign('theirs');
    const app = mount(repository);

    const body = (await (await app.request('/api/v1/dashboard/tests')).json()) as Array<
      Record<string, unknown>
    >;

    // An aggregate that quietly included the other install's rows would leak every
    // test name it has, one response, with no id to trace it back to.
    expect(body.map((test) => test['id'])).toEqual(['mine-test']);
    expect(JSON.stringify(body)).not.toContain('their secret test');
  });
});

// ---------------------------------------------------------------------------
// GET /api/v1/dashboard/suites
// ---------------------------------------------------------------------------

describe('GET /api/v1/dashboard/suites', () => {
  it('groups by test file and names the suite after the file, not the path', async () => {
    const repository = new InMemoryRunRepository();
    await repository.upsertRun(makeRun({ id: 'run-a' }));
    await repository.upsertTest(makeTest({ id: 'a1', runId: 'run-a' }));
    await repository.upsertTest(
      makeTest({ id: 'a2', runId: 'run-a', file: 'e2e/checkout.spec.ts', status: 'failed' }),
    );
    const app = mount(repository);

    const body = (await (await app.request('/api/v1/dashboard/suites')).json()) as Array<
      Record<string, unknown>
    >;

    expect(body.map((suite) => [suite['id'], suite['name']]).sort()).toEqual([
      ['e2e/auth/login.spec.ts', 'login.spec.ts'],
      ['e2e/checkout.spec.ts', 'checkout.spec.ts'],
    ]);
  });

  it('counts one suite once per run however many of its tests ran', async () => {
    // `totalRuns` is the number of *distinct* runs, not the number of tests. A run
    // that executed four tests in one file is one run of that suite, and reporting
    // four would make the suite look four times more exercised than it is.
    const repository = new InMemoryRunRepository();
    await repository.upsertRun(makeRun({ id: 'run-a' }));
    for (const id of ['a1', 'a2', 'a3', 'a4']) {
      await repository.upsertTest(makeTest({ id, runId: 'run-a' }));
    }
    const app = mount(repository);

    const body = (await (await app.request('/api/v1/dashboard/suites')).json()) as Array<
      Record<string, unknown>
    >;

    expect(body).toHaveLength(1);
    expect(body[0]?.['totalRuns']).toBe(1);
  });

  it('rounds the pass rate over every test, not over whole runs', async () => {
    // 2 passed, 1 failed, 1 flaky, 1 skipped → 40%. Only `passed` counts as a pass;
    // a flaky test is not a pass, and rounding a skipped one in would let a suite
    // report 60% for one passing test out of one.
    const repository = new InMemoryRunRepository();
    await repository.upsertRun(makeRun({ id: 'run-a' }));
    const statuses: TestRecord['status'][] = ['passed', 'passed', 'failed', 'flaky', 'skipped'];
    for (const [index, status] of statuses.entries()) {
      await repository.upsertTest(makeTest({ id: `t${String(index)}`, runId: 'run-a', status }));
    }
    const app = mount(repository);

    const body = (await (await app.request('/api/v1/dashboard/suites')).json()) as Array<
      Record<string, unknown>
    >;

    expect(body[0]?.['passRate']).toBe(40);
  });

  it('reports the most recent run that exercised the suite', async () => {
    const repository = new InMemoryRunRepository();
    await repository.upsertRun(makeRun({ id: 'older', startedAt: '2026-09-01T00:00:00.000Z' }));
    await repository.upsertRun(makeRun({ id: 'newer', startedAt: '2026-09-20T00:00:00.000Z' }));
    await repository.upsertTest(makeTest({ id: 'o1', runId: 'older' }));
    await repository.upsertTest(makeTest({ id: 'n1', runId: 'newer' }));
    const app = mount(repository);

    const body = (await (await app.request('/api/v1/dashboard/suites')).json()) as Array<
      Record<string, unknown>
    >;

    // Not insertion order: the later `upsertRun` above is also the later run, so a
    // fixture that agreed with insertion order would not have proved this.
    expect(body[0]?.['lastRunAt']).toBe('2026-09-20T00:00:00.000Z');
    expect(body[0]?.['totalRuns']).toBe(2);
  });

  it('omits a test whose parent run row is missing, rather than inventing a suite', async () => {
    // The aggregation walks `listRuns()` and asks each run for its tests, so a
    // test with no parent run is never reached. That is why the route's
    // `runById.get(run.id)?.startedAt ?? null` never fires: the map is built from
    // the same list that drives the loop, so the lookup always hits.
    //
    // It is unreachable in production too — `tests.run_id` references
    // `runs(id)` with `ON DELETE CASCADE`, so a test cannot outlive its run. The
    // assertion is here because "a test that exists in no suite" is a gap a caller
    // could otherwise only discover by counting, and because a future change that
    // made it reachable would change the answer here rather than silently.
    const repository = new InMemoryRunRepository();
    await repository.upsertTest(makeTest({ id: 'orphan', runId: 'run-that-was-deleted' }));
    const app = mount(repository);

    const listed = await app.request('/api/v1/dashboard/suites');

    expect(listed.status).toBe(200);
    expect(await listed.json()).toEqual([]);
    // The test row is still there; the suite view is what skipped it.
    expect(await repository.listTests('run-that-was-deleted')).toHaveLength(1);
  });

  it('folds tests with no file into a single Unknown Suite rather than dropping them', async () => {
    // A reporter that sends no `file` is normal, not exceptional. Dropping those
    // tests would make a suite's pass rate a statement about the tests that happened
    // to name a file.
    const repository = new InMemoryRunRepository();
    await repository.upsertRun(makeRun({ id: 'run-a' }));
    await repository.upsertTest(makeTest({ id: 'a1', runId: 'run-a', file: '', status: 'passed' }));
    await repository.upsertTest(makeTest({ id: 'a2', runId: 'run-a', file: '', status: 'failed' }));
    const app = mount(repository);

    const body = (await (await app.request('/api/v1/dashboard/suites')).json()) as Array<
      Record<string, unknown>
    >;

    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({ id: 'unknown', name: 'Unknown Suite', passRate: 50 });
  });

  it('answers 200 with an empty array when nothing has been ingested', async () => {
    const response = await mount(new InMemoryRunRepository()).request('/api/v1/dashboard/suites');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
  });

  it("does not report another workspace run's tests as a suite", async () => {
    const repository = new WorkspaceScopedRunRepository();
    await repository.upsertRun(makeRun({ id: 'mine' }));
    await repository.upsertTest(makeTest({ id: 'mine-test', runId: 'mine' }));
    await repository.upsertRun(makeRun({ id: 'theirs' }));
    await repository.upsertTest(
      makeTest({ id: 'their-test', runId: 'theirs', file: 'e2e/their-secret.spec.ts' }),
    );
    repository.markForeign('theirs');
    const app = mount(repository);

    const body = (await (await app.request('/api/v1/dashboard/suites')).json()) as Array<
      Record<string, unknown>
    >;

    expect(body.map((suite) => suite['id'])).toEqual(['e2e/auth/login.spec.ts']);
    expect(JSON.stringify(body)).not.toContain('their-secret');
  });
});

// ---------------------------------------------------------------------------
// GET /api/v1/dashboard/runs/:runId/tests
// ---------------------------------------------------------------------------

describe('GET /api/v1/dashboard/runs/:runId/tests', () => {
  it("returns only the requested run's tests", async () => {
    const repository = new InMemoryRunRepository();
    await repository.upsertRun(makeRun({ id: 'run-a' }));
    await repository.upsertRun(makeRun({ id: 'run-b' }));
    await repository.upsertTest(makeTest({ id: 'a1', runId: 'run-a' }));
    await repository.upsertTest(makeTest({ id: 'a2', runId: 'run-a', title: 'signs out' }));
    await repository.upsertTest(makeTest({ id: 'b1', runId: 'run-b', title: 'other run' }));
    const app = mount(repository);

    const body = (await (await app.request('/api/v1/dashboard/runs/run-a/tests')).json()) as Array<
      Record<string, unknown>
    >;

    expect(body.map((test) => test['id'])).toEqual(['a1', 'a2']);
  });

  it('returns an empty array for a run that exists but has no tests', async () => {
    const repository = new InMemoryRunRepository();
    await repository.upsertRun(makeRun({ id: 'run-a' }));
    const app = mount(repository);

    const response = await app.request('/api/v1/dashboard/runs/run-a/tests');

    // Not 404: the run is there, and "no tests yet" is a real answer the detail
    // page renders rather than an error it would have to special-case.
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
  });

  it('answers 404 for a run that does not exist', async () => {
    const response = await mount(new InMemoryRunRepository()).request(
      '/api/v1/dashboard/runs/ghost-run/tests',
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      error: { code: 'RUN_NOT_FOUND', message: 'Run not found' },
    });
  });

  it('answers 404 for a run id that could not exist, without a stack trace', async () => {
    const app = mount(new InMemoryRunRepository());

    for (const id of ['not-a-uuid', '%2e%2e%2fadmin', 'a'.repeat(400)]) {
      const response = await app.request(`/api/v1/dashboard/runs/${id}/tests`);
      expect(response.status, id.slice(0, 24)).toBe(404);
      expect(await response.text()).not.toContain('at ');
    }
  });

  it("hides another workspace run's tests behind the same 404", async () => {
    const repository = new WorkspaceScopedRunRepository();
    await repository.upsertRun(makeRun({ id: 'theirs' }));
    await repository.upsertTest(
      makeTest({ id: 'their-test', runId: 'theirs', title: 'their secret test' }),
    );
    repository.markForeign('theirs');
    const app = mount(repository);

    const response = await app.request('/api/v1/dashboard/runs/theirs/tests');

    expect(response.status).toBe(404);
    expect(response.status).not.toBe(403);
    expect(await response.json()).toMatchObject({
      error: { code: 'RUN_NOT_FOUND', message: 'Run not found' },
    });
  });
});
