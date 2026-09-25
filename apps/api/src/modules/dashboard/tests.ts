/**
 * tests.ts — Dashboard tests listing route
 *
 * GET /api/v1/dashboard/runs/:runId/tests — list all test records for a run
 */
import { Hono } from 'hono';
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
    const allTests = [] as Array<Awaited<ReturnType<RunRepository['listTests']>>[number]>;
    for (const run of runs) {
      const tests = await options.repository.listTests(run.id);
      allTests.push(...tests);
    }
    return c.json(allTests);
  });

  // ── GET /api/v1/dashboard/suites ────────────────────────────────────────
  // Derived suite summaries grouped by test file.
  app.get('/api/v1/dashboard/suites', async (c) => {
    const runs = await options.repository.listRuns();
    const runById = new Map(runs.map((run) => [run.id, run]));
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
      const tests = await options.repository.listTests(run.id);
      for (const test of tests) {
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
      return c.json({ error: 'Run not found' }, 404);
    }

    const tests = await options.repository.listTests(runId);
    return c.json(tests);
  });

  return app;
}
