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
  app.get('/api/v1/dashboard/analytics/summary', async (c) => {
    const runs = await options.repository.listRuns();

    // Pass-rate: percentage of completed runs that passed
    const completed = runs.filter((r) => r.status === 'passed' || r.status === 'failed');
    let passRate = 0;
    if (completed.length > 0) {
      const passed = completed.filter((r) => r.status === 'passed').length;
      passRate = Math.round((passed / completed.length) * 100);
    }

    // Average duration across runs that have a recorded duration
    const withDuration = runs.filter((r) => r.durationMs !== null);
    let avgDurationMs: number | null = null;
    if (withDuration.length > 0) {
      const total = withDuration.reduce((sum, r) => sum + (r.durationMs ?? 0), 0);
      avgDurationMs = Math.round(total / withDuration.length);
    }

    return c.json({
      totalRuns: runs.length,
      passRate,
      avgDurationMs,
    });
  });

  return app;
}
