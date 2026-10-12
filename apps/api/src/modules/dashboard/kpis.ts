/**
 * kpis.ts — the dashboard's KPIs, each carrying its unit.
 *
 * GET /api/v1/dashboard/kpis/summary → { kpis: [{ id, label, value, unit, denominator, qualifier }] }
 *
 * ## Why this exists beside `/analytics/summary`
 *
 * The analytics summary sends `passRate` as 0–100 and leaves a client to know that
 * `flakeRate` and `surfaceCoverage` are 0–1 ratios. Two formatters exist in the web
 * app for that, chosen at each call site by somebody remembering (ledger GLASS-3) —
 * and the answer a reader gets is `0.5%` for a 50 percent, which reads as true.
 *
 * Here every number arrives with the unit it was computed in, so the formatting
 * choice is made **once, by whoever computed it**, and a screen that cannot get it
 * wrong. The analytics summary stays where it is: a client that already knows the
 * shape keeps working, and the new endpoint is where the KPI screen reads from.
 */
import { Hono } from 'hono';
import type { RunRepository } from '../../repositories/run-repository.js';

export interface DashboardKpiOptions {
  repository: RunRepository;
}

export function createDashboardKpiRoutes(options: DashboardKpiOptions): Hono {
  const app = new Hono();

  app.get('/api/v1/dashboard/kpis/summary', async (c) => {
    return c.json(await options.repository.getKpiSummary());
  });

  return app;
}
