/**
 * apps/server/src/routes/analytics.ts
 *
 * Aggregated analytics endpoints consumed by the Analytics page.
 *
 * GET /api/analytics/pass-rate        → PassRatePoint[]
 * GET /api/analytics/duration         → DurationPoint[]
 * GET /api/analytics/flaky            → FlakyTest[]
 * GET /api/analytics/slow             → SlowTest[]
 * GET /api/analytics/heatmap          → HeatmapSerie[]
 * GET /api/analytics/gantt            → GanttRow[]
 * GET /api/analytics/error-clusters   → ClusterResult[]
 * GET /api/analytics/frequent-failures → FrequentFailure[]
 */
import type { FastifyInstance } from 'fastify';
import { db } from '../db/client.js';
import { runs, tests, results, failureClusters, testFailureCorrelations, quarantine } from '../db/schema.js';
import { sql, desc, and, isNotNull, ne, eq } from 'drizzle-orm';
import { requireFeature } from '../services/feature-flags.js';
import { DEFAULT_QUERY_LIMIT } from '../constants.js';
import { computeRiskScoresBatch, computeRiskSummary } from '../services/risk-scoring.js';
import { getPredictiveCandidates } from '../services/predictive-selection.js';
import { computeRoiMetrics, type RoiPeriod } from '../services/roi-metrics.js';

// ─── helpers ──────────────────────────────────────────────────────────────────

/** Safely parse a numeric query param with a default and max bound */
function parseIntParam(val: string | undefined, defaultVal: number, max: number): number {
  if (!val) return defaultVal;
  const n = Number(val);
  if (!Number.isFinite(n) || n <= 0) return defaultVal;
  return Math.min(Math.floor(n), max);
}

function cutoffDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

/** Simple percentile over a sorted numeric array */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))] ?? 0;
}

/** Convert an ISO timestamp to an ISO week string like "2026-W12" */
function toIsoWeek(isoDate: string): string {
  const d = new Date(isoDate);
  const dow = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dow);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

/** Build optional workspace filter for runs table */
function wsFilter(workspaceId?: string) {
  return workspaceId ? eq(runs.workspaceId, workspaceId) : undefined;
}

// ─── route plugin ─────────────────────────────────────────────────────────────

export async function analyticsRoutes(app: FastifyInstance): Promise<void> {
  // ── GET /api/analytics/pass-rate ──────────────────────────────────────────
  // Returns one row per day with pass-rate per project (or 'all').
  app.get<{ Querystring: { days?: string; project?: string; workspaceId?: string } }>(
    '/api/analytics/pass-rate',
    async (req, reply): Promise<void> => {
      const days = parseIntParam(req.query.days, 30, 365);
      const cutoff = cutoffDate(days);

      const rows = await db
        .select({
          date: sql<string>`substr(${runs.startedAt}, 1, 10)`.as('date'),
          passed: sql<number>`sum(${runs.passed})`.as('passed'),
          total: sql<number>`sum(${runs.total})`.as('total'),
        })
        .from(runs)
        .where(
          and(
            sql`substr(${runs.startedAt}, 1, 10) >= ${cutoff}`,
            ne(runs.status, 'running'),
            wsFilter(req.query.workspaceId),
          ),
        )
        .groupBy(sql`substr(${runs.startedAt}, 1, 10)`)
        .orderBy(sql`substr(${runs.startedAt}, 1, 10)`);

      // Shape into PassRatePoint: { date, all: number }
      const data = rows.map((r) => ({
        date: r.date,
        all: r.total > 0 ? Math.round((r.passed / r.total) * 100) : 0,
      }));

      return reply.send(data);
    },
  );

  // ── GET /api/analytics/duration ─────────────────────────────────────────
  // Returns one row per day with p50 / p95 suite duration (ms).
  app.get<{ Querystring: { days?: string; workspaceId?: string } }>(
    '/api/analytics/duration',
    async (req, reply): Promise<void> => {
      const days = parseIntParam(req.query.days, 30, 365);
      const cutoff = cutoffDate(days);

      const rows = await db
        .select({
          date: sql<string>`substr(${runs.startedAt}, 1, 10)`.as('date'),
          durationMs: runs.durationMs,
        })
        .from(runs)
        .where(
          and(
            sql`substr(${runs.startedAt}, 1, 10) >= ${cutoff}`,
            isNotNull(runs.durationMs),
            ne(runs.status, 'running'),
            wsFilter(req.query.workspaceId),
          ),
        )
        .orderBy(sql`substr(${runs.startedAt}, 1, 10)`);

      const byDate = new Map<string, number[]>();
      for (const r of rows) {
        if (r.durationMs == null) continue;
        if (!byDate.has(r.date)) byDate.set(r.date, []);
        byDate.get(r.date)!.push(r.durationMs);
      }

      const data = Array.from(byDate.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, durations]) => {
          const sorted = [...durations].sort((a, b) => a - b);
          return {
            date,
            p50: percentile(sorted, 50),
            p95: percentile(sorted, 95),
          };
        });

      return reply.send(data);
    },
  );

  // ── GET /api/analytics/flaky ──────────────────────────────────────────────
  // Top N tests that have appeared with status='flaky'.
  app.get<{ Querystring: { limit?: string; workspaceId?: string } }>(
    '/api/analytics/flaky',
    async (req, reply): Promise<void> => {
      const limit = parseIntParam(req.query.limit, DEFAULT_QUERY_LIMIT, 200);

      const rows = await db
        .select({
          title: tests.title,
          file: tests.file,
          flakyCount: sql<number>`count(*)`.as('flaky_count'),
          totalRuns: sql<number>`count(distinct ${tests.runId})`.as('total_runs'),
        })
        .from(tests)
        .innerJoin(runs, sql`${tests.runId} = ${runs.id}`)
        .where(and(sql`${tests.status} = 'flaky'`, wsFilter(req.query.workspaceId)))
        .groupBy(tests.title, tests.file)
        .orderBy(desc(sql`count(*)`))
        .limit(limit);

      const data = rows.map((r) => ({
        title: r.title,
        file: r.file,
        flakyCount: r.flakyCount,
        totalRuns: r.totalRuns,
        flakyRate: r.totalRuns > 0
          ? Math.round((r.flakyCount / r.totalRuns) * 100)
          : 0,
      }));

      return reply.send(data);
    },
  );

  // ── GET /api/analytics/slow ───────────────────────────────────────────────
  // Top N slowest tests by average duration across all runs.
  app.get<{ Querystring: { limit?: string; project?: string; workspaceId?: string } }>(
    '/api/analytics/slow',
    async (req, reply): Promise<void> => {
      const limit = parseIntParam(req.query.limit, 20, 100);

      const rows = await db
        .select({
          title: tests.title,
          file: tests.file,
          avgDurationMs: sql<number>`avg(${tests.durationMs})`.as('avg_duration_ms'),
          maxDurationMs: sql<number>`max(${tests.durationMs})`.as('max_duration_ms'),
          runCount: sql<number>`count(*)`.as('run_count'),
        })
        .from(tests)
        .innerJoin(runs, sql`${tests.runId} = ${runs.id}`)
        .where(and(isNotNull(tests.durationMs), wsFilter(req.query.workspaceId)))
        .groupBy(tests.title, tests.file)
        .orderBy(desc(sql`avg(${tests.durationMs})`))
        .limit(limit);

      const data = rows.map((r) => ({
        title: r.title,
        file: r.file,
        avgDurationMs: Math.round(r.avgDurationMs),
        p95DurationMs: Math.round(r.maxDurationMs), // max as p95 proxy
        runCount: r.runCount,
      }));

      return reply.send(data);
    },
  );

  // ── GET /api/analytics/heatmap ────────────────────────────────────────────
  // Returns failure heatmap data: failures grouped by file × date.
  app.get<{ Querystring: { days?: string; workspaceId?: string } }>(
    '/api/analytics/heatmap',
    async (req, reply): Promise<void> => {
      const days = parseIntParam(req.query.days, 30, 365);
      const cutoff = cutoffDate(days);

      const rows = await db
        .select({
          file: tests.file,
          date: sql<string>`substr(${runs.startedAt}, 1, 10)`.as('date'),
          failCount: sql<number>`count(*)`.as('fail_count'),
        })
        .from(tests)
        .innerJoin(runs, sql`${tests.runId} = ${runs.id}`)
        .where(
          and(
            sql`${tests.status} = 'failed'`,
            sql`substr(${runs.startedAt}, 1, 10) >= ${cutoff}`,
            wsFilter(req.query.workspaceId),
          ),
        )
        .groupBy(tests.file, sql`substr(${runs.startedAt}, 1, 10)`)
        .orderBy(tests.file);

      // Group into @nivo/heatmap format: { id: file, data: [{ x: date, y: count }] }
      const byFile = new Map<string, Array<{ x: string; y: number }>>();
      for (const r of rows) {
        if (!byFile.has(r.file)) byFile.set(r.file, []);
        byFile.get(r.file)!.push({ x: r.date ?? '', y: r.failCount });
      }
      const data = Array.from(byFile.entries()).map(([id, d]) => ({ id, data: d }));
      return reply.send(data);
    },
  );

  // ── GET /api/analytics/gantt ──────────────────────────────────────────────
  // Returns worker slot data for a specific run (for WorkerGantt chart).
  app.get<{ Querystring: { runId?: string } }>(
    '/api/analytics/gantt',
    async (req, reply): Promise<void> => {
      const runId = req.query.runId;
      if (!runId) return reply.status(400).send({ error: 'Missing required query parameter: runId' });

      const rows = await db
        .select({
          title: tests.title,
          file: tests.file,
          status: tests.status,
          workerIndex: tests.workerIndex,
          durationMs: tests.durationMs,
        })
        .from(tests)
        .where(sql`${tests.runId} = ${runId}`)
        .orderBy(tests.workerIndex);

      return reply.send(rows);
    },
  );

  // ── GET /api/analytics/error-clusters ─────────────────────────────────────
  // Clusters test failures by error message similarity for a specific run.
  app.get<{ Querystring: { runId?: string } }>(
    '/api/analytics/error-clusters',
    async (req, reply): Promise<void> => {
      const runId = req.query.runId;
      if (!runId) return reply.status(400).send({ error: 'Missing required query parameter: runId' });
      const { clusterErrors } = await import('../services/error-clustering.js');
      const clusters = await clusterErrors(runId);
      return reply.send(clusters);
    },
  );

  // ── GET /api/analytics/frequent-failures ─────────────────────────────────
  // Top 10 most frequent error messages across recent runs, gated by feature flag.
  app.get<{ Querystring: { days?: string; workspaceId?: string } }>(
    '/api/analytics/frequent-failures',
    { preHandler: requireFeature('frequent-failures') },
    async (req, reply): Promise<void> => {
      const days = parseIntParam(req.query.days, 30, 365);
      const cutoff = cutoffDate(days);

      const rows = await db
        .select({
          errorMessage: results.errorMessage,
          count: sql<number>`count(*)`.as('count'),
          lastSeen: sql<string>`max(${runs.startedAt})`.as('last_seen'),
          affectedTests: sql<string>`group_concat(distinct ${results.testId})`.as('affected_tests'),
        })
        .from(results)
        .innerJoin(runs, sql`${results.runId} = ${runs.id}`)
        .where(
          and(
            isNotNull(results.errorMessage),
            sql`${results.status} = 'failed'`,
            sql`substr(${runs.startedAt}, 1, 10) >= ${cutoff}`,
            wsFilter(req.query.workspaceId),
          ),
        )
        .groupBy(results.errorMessage)
        .orderBy(desc(sql`count(*)`))
        .limit(10);

      const data = rows.map((r) => ({
        errorMessage: r.errorMessage ?? '',
        count: r.count,
        lastSeen: r.lastSeen,
        affectedTests: r.affectedTests ? r.affectedTests.split(',') : [],
      }));

      return reply.send(data);
    },
  );

  // ── GET /api/analytics/failure-clusters ─────────────────────────────────
  // Returns cross-run failure clusters sorted by occurrence count desc.
  app.get<{ Querystring: { status?: string; sort?: string; limit?: string; offset?: string } }>(
    '/api/analytics/failure-clusters',
    { preHandler: requireFeature('cross-run-clusters') },
    async (req, reply): Promise<void> => {
      const status = req.query.status ?? 'active';
      const limit = parseIntParam(req.query.limit, 20, 200);
      const offset = parseIntParam(req.query.offset, 0, 100000);

      const rows = await db
        .select()
        .from(failureClusters)
        .where(eq(failureClusters.status, status as 'active' | 'resolved'))
        .orderBy(desc(failureClusters.occurrenceCount))
        .limit(limit)
        .offset(offset);

      return reply.send(rows);
    },
  );

  // ── GET /api/analytics/risk-scores ──────────────────────────────────────
  // Batch-compute risk scores for a comma-separated list of test stable IDs.
  app.get<{ Querystring: { stableIds?: string } }>(
    '/api/analytics/risk-scores',
    { preHandler: requireFeature('risk-scoring') },
    async (req, reply): Promise<void> => {
      const raw = req.query.stableIds ?? '';
      const stableIds = raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 1000); // hard cap — prevent unbounded queries

      const scores = await computeRiskScoresBatch(stableIds);
      return reply.send(scores);
    },
  );

  // ── GET /api/analytics/risk-scores/summary ───────────────────────────────
  // Suite-level risk overview: tier counts + top N risky tests.
  app.get<{ Querystring: { topN?: string } }>(
    '/api/analytics/risk-scores/summary',
    { preHandler: requireFeature('risk-scoring') },
    async (req, reply): Promise<void> => {
      const topN = parseIntParam(req.query.topN, 10, 100);
      const summary = await computeRiskSummary(topN);
      return reply.send(summary);
    },
  );

  // ── POST /api/analytics/predictive-selection ─────────────────────────────
  // Rank tests by likelihood of failure given a set of changed source files.
  // Returns tests sorted by score desc. Falls back to all known tests (equal
  // score, reason 'no_correlation_data') when no historical correlations exist
  // for the provided files.
  app.post<{ Body: { changedFiles?: string[]; testDir?: string } }>(
    '/api/analytics/predictive-selection',
    { preHandler: requireFeature('predictive-test-selection') },
    async (req, reply): Promise<void> => {
      const { changedFiles = [], testDir = 'tests' } = req.body ?? {};
      const result = await getPredictiveCandidates(changedFiles, testDir);

      if (result.candidates.length === 0 && changedFiles.length > 0) {
        // No correlation data for these files — return all known test stable IDs equally weighted
        const known = await db
          .select({ stableId: testFailureCorrelations.testStableId })
          .from(testFailureCorrelations)
          .groupBy(testFailureCorrelations.testStableId)
          .limit(10000);

        return reply.send({
          tests: known.map((t) => ({
            stableId: t.stableId,
            score: 1.0,
            reason: 'no_correlation_data',
          })),
        });
      }

      return reply.send({
        tests: result.candidates.map((c) => ({
          stableId: c.testFile,
          score: c.score,
          reason: c.reason,
        })),
      });
    },
  );

  // ── GET /api/analytics/roi-metrics ────────────────────────────────────────
  // Returns executive ROI / quality metrics for the given period.
  app.get<{ Querystring: { period?: string } }>(
    '/api/analytics/roi-metrics',
    { preHandler: [requireFeature('roi-metrics')] },
    async (req, reply): Promise<void> => {
      const rawPeriod = req.query.period ?? '30d';
      const validPeriods: RoiPeriod[] = ['30d', '60d', '90d'];
      const period: RoiPeriod = validPeriods.includes(rawPeriod as RoiPeriod)
        ? (rawPeriod as RoiPeriod)
        : '30d';

      const metrics = await computeRoiMetrics(period);
      return reply.send(metrics);
    },
  );

  // ── GET /api/analytics/flakiness-breakdown ────────────────────────────────
  // Count quarantined tests grouped by flakiness_category.
  app.get(
    '/api/analytics/flakiness-breakdown',
    { preHandler: [requireFeature('auto-quarantine')] },
    async (_req, reply): Promise<void> => {
      const rows = await db
        .select({
          category: quarantine.flakinessCategory,
          count: sql<number>`count(*)`.as('count'),
        })
        .from(quarantine)
        .groupBy(quarantine.flakinessCategory);

      const breakdown: Record<string, number> = {
        timing: 0,
        environment: 0,
        data: 0,
        assertion_drift: 0,
        unknown: 0,
      };

      let total = 0;
      for (const row of rows) {
        const cat = row.category ?? 'unknown';
        const key = cat in breakdown ? cat : 'unknown';
        breakdown[key] = (breakdown[key] ?? 0) + row.count;
        total += row.count;
      }

      return reply.send({ ...breakdown, total });
    },
  );

  // ── GET /api/analytics/time-to-fix ──────────────────────────────────────
  // TTF statistics for quarantined tests.
  app.get(
    '/api/analytics/time-to-fix',
    { preHandler: [requireFeature('auto-quarantine')] },
    async (_req, reply): Promise<void> => {
      const allRows = await db.select().from(quarantine);

      const resolvedRows = allRows.filter(
        (r): r is typeof r & { ttfMs: number; resolvedAt: string } =>
          r.resolvedAt !== null && r.ttfMs !== null,
      );
      const activeRows = allRows.filter(
        (r) => r.resolvedAt === null && r.status === 'approved',
      );

      const ttfValues = resolvedRows.map((r) => r.ttfMs).sort((a, b) => a - b);

      const avg =
        ttfValues.length > 0
          ? ttfValues.reduce((s, v) => s + v, 0) / ttfValues.length
          : 0;

      // byCategory: average TTF per flakiness category
      const byCategoryMap = new Map<string, { sum: number; count: number }>();
      for (const row of resolvedRows) {
        const cat = row.flakinessCategory ?? 'unknown';
        const entry = byCategoryMap.get(cat) ?? { sum: 0, count: 0 };
        entry.sum += row.ttfMs;
        entry.count++;
        byCategoryMap.set(cat, entry);
      }
      const byCategory: Record<string, { avgTtfMs: number; count: number }> = {};
      for (const [cat, { sum, count }] of byCategoryMap) {
        byCategory[cat] = { avgTtfMs: Math.round(sum / count), count };
      }

      // trend: last 12 weeks
      const weekMap = new Map<string, { sum: number; count: number }>();
      for (const row of resolvedRows) {
        const week = toIsoWeek(row.resolvedAt);
        const entry = weekMap.get(week) ?? { sum: 0, count: 0 };
        entry.sum += row.ttfMs;
        entry.count++;
        weekMap.set(week, entry);
      }
      const trend = [...weekMap.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .slice(-12)
        .map(([week, { sum, count }]) => ({
          week,
          avgTtfMs: Math.round(sum / count),
          resolvedCount: count,
        }));

      return reply.send({
        avgTtfMs: Math.round(avg),
        medianTtfMs: Math.round(percentile(ttfValues, 50)),
        p95TtfMs: Math.round(percentile(ttfValues, 95)),
        activeCount: activeRows.length,
        resolvedCount: resolvedRows.length,
        byCategory,
        trend,
      });
    },
  );

}
