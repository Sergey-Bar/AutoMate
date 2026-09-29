/**
 * tests.ts — Dashboard tests listing route
 *
 * GET /api/v1/dashboard/runs/:runId/tests — list all test records for a run
 */
import { Hono } from 'hono';
import { DomainError } from '../../errors/domain-error.js';
import type { RunRepository } from '../../repositories/run-repository.js';

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface DashboardTestsOptions {
  repository: RunRepository;
}

// ---------------------------------------------------------------------------
// Route factory
// ---------------------------------------------------------------------------

export function createDashboardTestsRoutes(options: DashboardTestsOptions): Hono {
  const app = new Hono();

  // ── GET /api/v1/dashboard/tests ─────────────────────────────────────────
  // Aggregated test list across all runs.
  app.get('/api/v1/dashboard/tests', async (c) => {
    const runs = await options.repository.listRuns();
    // One call for every run, not one per run. Looping `listTests(run.id)` cost
    // one round trip per run, so the dashboard's answer got slower every time a
    // run was added — for a question whose result does not depend on how many
    // runs there are (ledger Q-47).
    const byRun = await options.repository.listTestsForRuns(runs.map((run) => run.id));
    const allTests = [] as Array<Awaited<ReturnType<RunRepository['listTests']>>[number]>;
    for (const run of runs) allTests.push(...(byRun.get(run.id) ?? []));
    return c.json(allTests);
  });

  // ── GET /api/v1/dashboard/suites ────────────────────────────────────────
  // Derived suite summaries grouped by test file.
  app.get('/api/v1/dashboard/suites', async (c) => {
    const runs = await options.repository.listRuns();
    const runById = new Map(runs.map((run) => [run.id, run]));
    // The same single call as above; the loop below no longer awaits.
    const testsByRun = await options.repository.listTestsForRuns(runs.map((run) => run.id));
    const suiteMap = new Map<
      string,
      {
        id: string;
        name: string;
        runIds: Set<string>;
        passed: number;
        total: number;
        lastRunAt: string | null;
      }
    >();

    for (const run of runs) {
      for (const test of testsByRun.get(run.id) ?? []) {
        const suiteId = test.file || 'unknown';
        const suiteName = test.file ? (test.file.split('/').pop() ?? test.file) : 'Unknown Suite';
        const existing = suiteMap.get(suiteId) ?? {
          id: suiteId,
          name: suiteName,
          runIds: new Set<string>(),
          passed: 0,
          total: 0,
          lastRunAt: null,
        };

        existing.runIds.add(run.id);
        existing.total += 1;
        if (test.status === 'passed') {
          existing.passed += 1;
        }

        const runStartedAt = runById.get(run.id)?.startedAt ?? null;
        if (runStartedAt && (!existing.lastRunAt || runStartedAt > existing.lastRunAt)) {
          existing.lastRunAt = runStartedAt;
        }

        suiteMap.set(suiteId, existing);
      }
    }

    const suites = Array.from(suiteMap.values()).map((suite) => ({
      id: suite.id,
      name: suite.name,
      projectName: undefined,
      totalRuns: suite.runIds.size,
      lastRunAt: suite.lastRunAt,
      passRate: suite.total === 0 ? null : Math.round((suite.passed / suite.total) * 100),
    }));

    return c.json(suites);
  });

  // ── GET /api/v1/dashboard/runs/:runId/tests ───────────────────────────────
  app.get('/api/v1/dashboard/runs/:runId/tests', async (c) => {
    const runId = c.req.param('runId');

    // Verify parent run exists first
    const run = await options.repository.getRun(runId);
    if (!run) {
      throw new DomainError('RUN_NOT_FOUND', 'Run not found');
    }

    const tests = await options.repository.listTests(runId);
    return c.json(tests);
  });

  return app;
}
