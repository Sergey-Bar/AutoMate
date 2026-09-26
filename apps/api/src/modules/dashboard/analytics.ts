/**
 * analytics.ts — Dashboard analytics summary route
 *
 * GET /api/v1/dashboard/analytics/summary
 *   → { totalRuns, passRate, avgDurationMs }
 *
 * passRate    — percentage of completed runs (passed|failed) that passed
 * avgDurationMs — average durationMs across all runs that have a recorded duration
 */
import { Hono } from 'hono';
import type { RunRepository } from '../../repositories/run-repository.js';

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface DashboardAnalyticsOptions {
  repository: RunRepository;
}

// ---------------------------------------------------------------------------
// Route factory
// ---------------------------------------------------------------------------

export function createDashboardAnalyticsRoutes(options: DashboardAnalyticsOptions): Hono {
  const app = new Hono();

  // ── GET /api/v1/dashboard/analytics/summary ───────────────────────────────
  //
  // Aggregated in the repository, not here. This used to call `listRuns()` and
  // reduce the result here, which selected **every run in the installation**,
  // materialised it in Node and computed three numbers from it — on the page an
  // operator opens first after an incident, at a cost that grew with how long the
  // install had been running.
  app.get('/api/v1/dashboard/analytics/summary', async (c) => {
    return c.json(await options.repository.getAnalyticsSummary());
  });

  return app;
}
