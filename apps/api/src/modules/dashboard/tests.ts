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

interface SuiteTally {
  id: string;
  name: string;
  runIds: Set<string>;
  passed: number;
  total: number;
  lastRunAt: string | null;
}

function newSuiteTally(suiteId: string, file: string | null | undefined): SuiteTally {
  return {
    id: suiteId,
    name: file ? (file.split('/').pop() ?? file) : 'Unknown Suite',
    runIds: new Set<string>(),
    passed: 0,
    total: 0,
    lastRunAt: null,
  };
}

/** Count one test into its suite, and move the suite's last-run time forward if this is later. */
function tallyTest(
  suite: SuiteTally,
  runId: string,
  status: string,
  runStartedAt: string | null,
): void {
  suite.runIds.add(runId);
  suite.total += 1;
  if (status === 'passed') suite.passed += 1;
  if (runStartedAt && (!suite.lastRunAt || runStartedAt > suite.lastRunAt)) {
    suite.lastRunAt = runStartedAt;
  }
}
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
    const suiteMap = new Map<string, SuiteTally>();

    for (const run of runs) {
      const runStartedAt = runById.get(run.id)?.startedAt ?? null;
      for (const test of testsByRun.get(run.id) ?? []) {
        const suiteId = test.file || 'unknown';
        const existing = suiteMap.get(suiteId) ?? newSuiteTally(suiteId, test.file);
        tallyTest(existing, run.id, test.status, runStartedAt);
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
