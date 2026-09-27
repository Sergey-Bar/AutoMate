/**
 * analytics.test.ts — `GET /api/v1/dashboard/analytics/summary`.
 *
 * The route is a pass-through to `repository.getAnalyticsSummary()`, and that is
 * the point of the test: this file pins the three numbers the dashboard shows an
 * operator after an incident, from real rows, and pins that the route does *not*
 * recompute them from `listRuns()`.
 */
import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { InMemoryRunRepository } from '../../repositories/in-memory-run-repository.js';
import {
  aggregateRuns,
  type RunAnalyticsSummary,
  type RunRecord,
} from '../../repositories/run-repository.js';
import { createDashboardAnalyticsRoutes } from './analytics.js';

function makeRun(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    id: 'run-a',
    startedAt: '2026-09-20T10:00:00.000Z',
    finishedAt: null,
    status: 'running',
    total: 0,
    passed: 0,
    failed: 0,
    flaky: 0,
    skipped: 0,
    durationMs: null,
    branch: 'main',
    commitSha: 'abc1234',
    triggeredBy: 'ci',
    ...overrides,
  };
}

/**
 * Counts how many times the route asked the store to enumerate runs.
 *
 * The route used to call `listRuns()` and reduce the result in JavaScript, which
 * selected every run in the installation to compute a count, a percentage and an
 * average — on the page an operator opens first. The aggregation is the store's
 * job now, and a test that only checked the numbers would pass just as happily
 * over the expensive implementation.
 */
class CountingRunRepository extends InMemoryRunRepository {
  listRunsCalls = 0;

  override async listRuns(): Promise<RunRecord[]> {
    this.listRunsCalls += 1;
    return super.listRuns();
  }
}

function mount(repository: InMemoryRunRepository): Hono {
  return new Hono().route('/', createDashboardAnalyticsRoutes({ repository }));
}

async function summary(app: Hono): Promise<Record<string, unknown>> {
  const response = await app.request('/api/v1/dashboard/analytics/summary');
  expect(response.status).toBe(200);
  return (await response.json()) as Record<string, unknown>;
}

describe('GET /api/v1/dashboard/analytics/summary', () => {
  it('reports zeroes and a null average for an installation with no runs', async () => {
    const body = await summary(mount(new InMemoryRunRepository()));

    // `avgDurationMs: null` and not `0`: no run recorded a duration is a different
    // statement from every run being instant, and a dashboard that renders 0 ms
    // for "we do not know" is lying to the operator reading it.
    expect(body).toEqual({ totalRuns: 0, passRate: 0, avgDurationMs: null });
  });

  it('counts every run, whatever its status', async () => {
    const repository = new InMemoryRunRepository();
    for (const status of ['running', 'passed', 'failed', 'interrupted'] as const) {
      await repository.upsertRun(makeRun({ id: `run-${status}`, status }));
    }

    const body = await summary(mount(repository));

    expect(body['totalRuns']).toBe(4);
  });

  it('takes the pass rate over completed runs only', async () => {
    // Two still executing, one passed, one failed → 50%, not 25%. Counting an
    // in-flight run as a failure turns "two tests are still going" into "half this
    // installation is broken", which is the number a release decision is made on.
    const repository = new InMemoryRunRepository();
    await repository.upsertRun(makeRun({ id: 'r1', status: 'running' }));
    await repository.upsertRun(makeRun({ id: 'r2', status: 'running' }));
    await repository.upsertRun(makeRun({ id: 'r3', status: 'passed' }));
    await repository.upsertRun(makeRun({ id: 'r4', status: 'failed' }));

    const body = await summary(mount(repository));

    expect(body['passRate']).toBe(50);
    expect(body['totalRuns']).toBe(4);
  });

  it('reports 0 when every completed run failed, and when none completed at all', async () => {
    const allFailed = new InMemoryRunRepository();
    await allFailed.upsertRun(makeRun({ id: 'r1', status: 'failed' }));
    await allFailed.upsertRun(makeRun({ id: 'r2', status: 'failed' }));
    const allRunning = new InMemoryRunRepository();
    await allRunning.upsertRun(makeRun({ id: 'r1', status: 'running' }));
    await allRunning.upsertRun(makeRun({ id: 'r2', status: 'interrupted' }));

    expect((await summary(mount(allFailed)))['passRate']).toBe(0);
    // The division has no denominator here. 0 is the honest answer for "nothing
    // has finished", and it is what an operator would read from 0/0 anyway.
    expect((await summary(mount(allRunning)))['passRate']).toBe(0);
  });

  it('rounds the pass rate to a whole percentage', async () => {
    const repository = new InMemoryRunRepository();
    for (let index = 0; index < 3; index += 1) {
      await repository.upsertRun(makeRun({ id: `p${String(index)}`, status: 'passed' }));
    }
    await repository.upsertRun(makeRun({ id: 'f1', status: 'failed' }));

    // 3/4 = 75 exactly. A sixth case would give 66.67 and prove the rounding.
    expect((await summary(mount(repository)))['passRate']).toBe(75);
  });

  it('averages only the runs that recorded a duration', async () => {
    const repository = new InMemoryRunRepository();
    await repository.upsertRun(makeRun({ id: 'r1', status: 'passed', durationMs: 1000 }));
    await repository.upsertRun(makeRun({ id: 'r2', status: 'passed', durationMs: 2000 }));
    // A run that never finished has no duration. Averaging it in as zero would drag
    // the mean towards "instant" by exactly the amount of the runs that are missing.
    await repository.upsertRun(makeRun({ id: 'r3', status: 'running', durationMs: null }));

    const body = await summary(mount(repository));

    expect(body['avgDurationMs']).toBe(1500);
    expect(body['totalRuns']).toBe(3);
  });

  it('averages across every status, not only the completed ones', async () => {
    const repository = new InMemoryRunRepository();
    await repository.upsertRun(makeRun({ id: 'r1', status: 'passed', durationMs: 400 }));
    await repository.upsertRun(makeRun({ id: 'r2', status: 'running', durationMs: 600 }));

    expect((await summary(mount(repository)))['avgDurationMs']).toBe(500);
  });

  it('reads the numbers from the store without enumerating the runs', async () => {
    const repository = new CountingRunRepository();
    for (let index = 0; index < 5; index += 1) {
      await repository.upsertRun(makeRun({ id: `run-${String(index)}`, status: 'passed' }));
    }
    const app = mount(repository);

    const body = await summary(app);

    expect(body['totalRuns']).toBe(5);
    // The assertion that keeps the summary a query. `listRuns` is exported on the
    // in-memory store, so a regression here is a plain counter going up.
    expect(repository.listRunsCalls).toBe(0);
  });

  it('answers the same three keys and nothing else', async () => {
    // The client parses this with a Zod object; an added key is a silent contract
    // change and a removed one is a render crash, so the shape is stated.
    const body = await summary(mount(new InMemoryRunRepository()));

    expect(Object.keys(body).sort()).toEqual(['avgDurationMs', 'passRate', 'totalRuns']);
  });

  it('excludes a run belonging to another WORKSPACE_ID from all three numbers', async () => {
    // The tenancy filter is the store's — `RunRepository` carries no workspace, see
    // `runs.test.ts` — so this is asserted over a store that applies one: a foreign
    // run must move no number here, or the summary is a statement about another
    // installation's health.
    class WorkspaceScopedRunRepository extends InMemoryRunRepository {
      override async listRuns(): Promise<RunRecord[]> {
        return (await super.listRuns()).filter((run) => run.id !== 'theirs');
      }

      override async getAnalyticsSummary(): Promise<RunAnalyticsSummary> {
        return aggregateRuns(await this.listRuns());
      }
    }

    const repository = new WorkspaceScopedRunRepository();
    await repository.upsertRun(makeRun({ id: 'mine-1', status: 'passed', durationMs: 1000 }));
    await repository.upsertRun(makeRun({ id: 'mine-2', status: 'failed', durationMs: 2000 }));
    await repository.upsertRun(makeRun({ id: 'theirs', status: 'failed', durationMs: 9_000_000 }));

    const body = await summary(mount(repository));

    // Only this installation's two runs, and the foreign run's nine thousand
    // seconds of runtime is nowhere in the average.
    expect(body).toEqual({ totalRuns: 2, passRate: 50, avgDurationMs: 1500 });
  });
});
