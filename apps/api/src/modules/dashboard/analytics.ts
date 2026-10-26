/**
 * analytics.ts — Dashboard analytics summary route
 *
 * GET /api/v1/dashboard/analytics/summary
 *   → { totalRuns, passRate, avgDurationMs }
 *
 * passRate    — percentage of completed runs (passed|failed) that passed; null when none has
 *               completed, which is a different statement from every run failing
 * avgDurationMs — average durationMs across all runs that have a recorded duration
 */
import { Hono } from 'hono';
import { DashboardAnalyticsSummarySchema } from '@automate/shared-contracts';
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
    // Parsed against the contract, so the shape the web reads is the shape this sends.
    return c.json(
      DashboardAnalyticsSummarySchema.parse(await options.repository.getAnalyticsSummary()),
    );
  });

  return app;
}
