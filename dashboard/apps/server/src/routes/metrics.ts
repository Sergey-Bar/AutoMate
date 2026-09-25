import type { FastifyInstance } from 'fastify';
import { db } from '../db/client.js';
import { sql } from 'drizzle-orm';

/** Normalize db.execute() results across postgres (returns {rows}) and SQLite (returns array). */
function getRows<T>(result: T[] | { rows: T[] }): T[] {
  return Array.isArray(result) ? result : result.rows;
}

export async function metricsRoutes(app: FastifyInstance) {
  app.get('/metrics', async (_req, reply) => {
    try {
      // Total runs by status
      const runCounts = getRows<{ status: string; cnt: string | number }>(
        await db.execute(sql`SELECT status, COUNT(*) as cnt FROM runs GROUP BY status`)
      );

      // Total tests across all runs (latest run only for active count)
      const latestRunRows = getRows<{ id: string; total: number; passed: number; failed: number; flaky: number; skipped: number; duration_ms: number | null; status: string }>(
        await db.execute(sql`SELECT id, total, passed, failed, flaky, skipped, duration_ms, status FROM runs ORDER BY started_at DESC LIMIT 1`)
      );
      const latestRun = latestRunRows[0];

      // Overall pass rate from last 30 days
      const last30Days = new Date();
      last30Days.setDate(last30Days.getDate() - 30);
      const last30Iso = last30Days.toISOString();

      const last30Rows = getRows<{ totalpassed: string | number | null; totaltests: string | number | null }>(
        await db.execute(sql`SELECT SUM(passed) as totalpassed, SUM(total) as totaltests FROM runs WHERE started_at > ${last30Iso} AND status != 'running'`)
      );
      const last30 = last30Rows[0];
      const totalTests = last30?.totaltests ? Number(last30.totaltests) : 0;
      const totalPassed = last30?.totalpassed ? Number(last30.totalpassed) : 0;
      const passRate = totalTests > 0 ? totalPassed / totalTests : 0;

      // Average duration from last 30 completed runs
      const avgDurationRows = getRows<{ avg: string | number | null }>(
        await db.execute(sql`SELECT AVG(duration_ms) as avg FROM (SELECT duration_ms FROM runs WHERE status != 'running' AND duration_ms IS NOT NULL ORDER BY started_at DESC LIMIT 30) sub`)
      );
      const avgDuration = avgDurationRows[0];

      // Flaky tests count (from quarantine table)
      let flakyCount = { cnt: 0 };
      try {
        const flakyCountRows = getRows<{ cnt: string | number }>(
          await db.execute(sql`SELECT COUNT(*) as cnt FROM quarantine`)
        );
        flakyCount = flakyCountRows[0] || { cnt: 0 };
      } catch (err) {
        app.log.debug(`Failed to query quarantine table: ${err}`);
      }

      // Active runs (currently running)
      const activeRunsRows = getRows<{ cnt: string | number }>(
        await db.execute(sql`SELECT COUNT(*) as cnt FROM runs WHERE status = 'running'`)
      );
      const activeRuns = activeRunsRows[0];

      // Build Prometheus exposition format
      const lines: string[] = [
        '# HELP automate_dashboard_runs_total Total number of test runs by status',
        '# TYPE automate_dashboard_runs_total counter',
      ];

      const statuses = ['passed', 'failed', 'interrupted', 'running'];
      for (const status of statuses) {
        const row = runCounts.find((r) => r.status === status);
        const count = row ? Number(row.cnt) : 0;
        lines.push(`automate_dashboard_runs_total{status="${status}"} ${count}`);
      }

      lines.push(
        '',
        '# HELP automate_dashboard_pass_rate Overall pass rate over last 30 days',
        '# TYPE automate_dashboard_pass_rate gauge',
        `automate_dashboard_pass_rate ${passRate.toFixed(4)}`,
        '',
        '# HELP automate_dashboard_avg_duration_seconds Average run duration in seconds (last 30 runs)',
        '# TYPE automate_dashboard_avg_duration_seconds gauge',
        `automate_dashboard_avg_duration_seconds ${(Number(avgDuration?.avg ?? 0) / 1000).toFixed(3)}`,
        '',
        '# HELP automate_dashboard_flaky_tests_count Number of quarantined (flaky) tests',
        '# TYPE automate_dashboard_flaky_tests_count gauge',
        `automate_dashboard_flaky_tests_count ${Number(flakyCount?.cnt ?? 0)}`,
        '',
        '# HELP automate_dashboard_active_runs Number of currently running test runs',
        '# TYPE automate_dashboard_active_runs gauge',
        `automate_dashboard_active_runs ${Number(activeRuns?.cnt ?? 0)}`,
      );

      if (latestRun) {
        lines.push(
          '',
          '# HELP automate_dashboard_latest_run_total Total tests in latest run',
          '# TYPE automate_dashboard_latest_run_total gauge',
          `automate_dashboard_latest_run_total ${latestRun.total}`,
          '# HELP automate_dashboard_latest_run_passed Passed tests in latest run',
          '# TYPE automate_dashboard_latest_run_passed gauge',
          `automate_dashboard_latest_run_passed ${latestRun.passed}`,
          '# HELP automate_dashboard_latest_run_failed Failed tests in latest run',
          '# TYPE automate_dashboard_latest_run_failed gauge',
          `automate_dashboard_latest_run_failed ${latestRun.failed}`,
        );
      }

      return reply
        .header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
        .send(lines.join('\n') + '\n');
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({ error: (err as Error).message });
    }
  });
}
