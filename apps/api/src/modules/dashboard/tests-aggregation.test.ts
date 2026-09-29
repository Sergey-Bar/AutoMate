import { describe, expect, it, vi } from 'vitest';
import { createDashboardTestsRoutes } from './tests.js';
import type { RunRepository, RunRecord, TestRecord } from '../../repositories/run-repository.js';

const run = (id: string): RunRecord =>
  ({
    id,
    projectId: 'web',
    status: 'completed',
    createdAt: '2026-09-01T00:00:00.000Z',
    startedAt: '2026-09-01T00:00:01.000Z',
    completedAt: '2026-09-01T00:01:00.000Z',
    branch: 'main',
    commitSha: 'abc123',
    pipeline: null,
    environment: 'local',
    trigger: 'manual',
    releaseId: null,
    policyEvaluation: null,
  }) as unknown as RunRecord;

const test = (runId: string, name: string): TestRecord =>
  ({
    testId: `${runId}:${name}`,
    runId,
    name,
    file: 'tests/checkout.spec.ts',
    status: 'passed',
    durationMs: 5,
  }) as unknown as TestRecord;

/**
 * A repository that counts the calls, so "one query" and "one per run" are
 * different assertions rather than the same one.
 *
 * `listTestsForRuns` is what the routes call; `listTests` is left uncalled on
 * purpose so a regression that goes back to the per-run path shows up as a
 * failing call count rather than passing against a stub that serves both.
 */
function countingRepository(runs: RunRecord[]): { repository: RunRepository; calls: () => number } {
  let listTestsCalls = 0;
  let batchedCalls = 0;
  const repository = {
    listRuns: vi.fn().mockResolvedValue(runs),
    listTests: vi.fn((runId: string) => {
      listTestsCalls += 1;
      return Promise.resolve([test(runId, 'a')]);
    }),
    listTestsForRuns: vi.fn((runIds: readonly string[]) => {
      batchedCalls += 1;
      return Promise.resolve(new Map(runIds.map((runId) => [runId, [test(runId, 'a')]])));
    }),
  } as unknown as RunRepository;
  return { repository, calls: () => listTestsCalls + batchedCalls };
}

describe('the dashboard test aggregation is not an N+1', () => {
  it('fetches every run’s tests in one call, not one per run', async () => {
    // `listTests` is single-run, so the aggregation used to call it once per run:
    // one query for the runs and then N for the tests. On a dashboard with a
    // thousand runs that is a thousand round trips to answer "what tests exist",
    // and the cost grows with the data (ledger Q-47).
    //
    // The analytics half of this module is already in SQL with a parity test; this
    // half is not, and a call count is the only assertion that says so. Asserting
    // the *response* would pass against the N+1 unchanged.
    const runs = [run('r-1'), run('r-2'), run('r-3'), run('r-4'), run('r-5')];
    const { repository, calls } = countingRepository(runs);

    const response = await createDashboardTestsRoutes({ repository }).request(
      '/api/v1/dashboard/tests',
    );

    expect(response.status).toBe(200);
    expect(calls(), 'one call for every run, not one per run').toBeLessThanOrEqual(1);
  });

  it('still returns every test, so the batching did not lose rows', async () => {
    // The call-count assertion alone would pass on a fix that fetched the first
    // run only. The two together are what make it a batching fix.
    const runs = [run('r-1'), run('r-2'), run('r-3')];
    const { repository } = countingRepository(runs);

    const response = await createDashboardTestsRoutes({ repository }).request(
      '/api/v1/dashboard/tests',
    );
    const body = (await response.json()) as Array<{ runId: string }>;

    expect(body).toHaveLength(3);
    expect(body.map((t) => t.runId).sort()).toEqual(['r-1', 'r-2', 'r-3']);
  });

  it('groups suites without one call per run', async () => {
    // The same defect in the suites route: it walked runs and awaited
    // `listTests(run.id)` inside the loop.
    const runs = [run('r-1'), run('r-2'), run('r-3'), run('r-4')];
    const { repository, calls } = countingRepository(runs);

    const response = await createDashboardTestsRoutes({ repository }).request(
      '/api/v1/dashboard/suites',
    );

    expect(response.status).toBe(200);
    expect(calls()).toBeLessThanOrEqual(1);
    const suites = (await response.json()) as Array<{ id: string; totalRuns: number }>;
    // One suite, seen in four runs — which is the grouping the route exists to do.
    expect(suites).toHaveLength(1);
    expect(suites[0]?.totalRuns).toBe(4);
  });

  it('makes at most one call when there are no runs at all', async () => {
    // The first version asserted zero calls, which was wrong: the route calls the
    // repository once and the *repository* returns before touching the database.
    // A method call is not a query, and the property worth pinning is that an
    // empty `runIds` does not reach Postgres — `inArray([])` is a query it
    // rejects, not one it answers, which is why both implementations short-circuit.
    const { repository, calls } = countingRepository([]);
    const response = await createDashboardTestsRoutes({ repository }).request(
      '/api/v1/dashboard/tests',
    );
    expect(await response.json()).toEqual([]);
    expect(calls()).toBeLessThanOrEqual(1);
  });
});
