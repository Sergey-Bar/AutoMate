import type { FastifyInstance } from 'fastify';
import { db, isPostgres } from '../db/client.js';
import { runs, qualityGateConfig } from '../db/schema.js';
import { eq, desc, and, sql } from 'drizzle-orm';
import { runner } from '../services/runner.js';
import type { ReporterBridge } from '../services/reporter-bridge.js';
import { z } from 'zod';
import { generateHtmlReport } from '../services/html-report.js';
import { generateRunPdf } from '../services/pdf-report.js';
import { generateStakeholderReport, VALID_TEMPLATES } from '../services/stakeholder-reports.js';
import { toCsv } from '../utils/csv-util.js';
import { generateJUnitXml } from '../utils/xml-util.js';
import { validateOrReply } from '../lib/validate-or-reply.js';
import { CSV_EXPORT_LIMIT } from '../constants.js';

/** Normalize db.execute() results across postgres (returns {rows}) and SQLite (returns array). */
function getRows<T>(result: T[] | { rows: T[] }): T[] {
  return Array.isArray(result) ? result : result.rows;
}

const StartRunBody = z.object({
  projects: z.array(z.string()).optional(),
  grep: z.string().optional(),
  workers: z.number().int().min(1).max(128).optional(),
  retries: z.number().int().min(0).max(10).optional(),
  trace: z.enum(['off', 'on', 'on-first-retry', 'retain-on-failure']).optional(),
  headed: z.boolean().optional(),
  shard: z.object({ current: z.number(), total: z.number() }).optional(),
  timeout: z.number().optional(),
  maxFailures: z.number().optional(),
  lastFailed: z.boolean().optional(),
  updateSnapshots: z.boolean().optional(),
  tags: z.array(z.string()).optional(),
  configPath: z.string().optional(),
  dryRun: z.boolean().optional(),
});

const RunsListQuery = z.object({
  workspaceId: z.string().optional(),
  branch: z.string().optional(),
  status: z.enum(['running', 'passed', 'failed', 'interrupted']).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export async function runsRoutes(app: FastifyInstance, { bridge }: { bridge: ReporterBridge }): Promise<void> {
  // POST /api/runs — start a new run
  app.post('/api/runs', async (req, reply): Promise<void> => {
    const body = await validateOrReply(StartRunBody, req, reply);
    if (!body) return;
    const runId = await runner.startRun(body, bridge);
    return reply.status(201).send({ runId });
  });

  // GET /api/runs/export.csv — download all runs as CSV
  app.get('/api/runs/export.csv', async (_req, reply): Promise<void> => {
    const allRuns = await db.select().from(runs).orderBy(desc(runs.startedAt)).limit(CSV_EXPORT_LIMIT);
    const headers = ['id', 'status', 'startedAt', 'finishedAt', 'total', 'passed', 'failed', 'flaky', 'skipped', 'durationMs', 'branch', 'commitSha', 'triggeredBy'];
    const csv = toCsv(allRuns as Array<Record<string, unknown>>, headers);
    if (allRuns.length >= CSV_EXPORT_LIMIT) {
      reply.header('X-Truncated', 'true');
    }
    return reply
      .header('Content-Type', 'text/csv')
      .header('Content-Disposition', 'attachment; filename="runs.csv"')
      .send(csv);
  });

  // GET /api/runs/:id/gate-status — CI-consumable gate result
  app.get<{ Params: { id: string } }>('/api/runs/:id/gate-status', async (req, reply): Promise<void> => {
    const [run] = await db.select().from(runs).where(eq(runs.id, req.params.id));
    if (!run) return reply.status(404).send({ error: 'Run not found' });

    const [cfg] = await db.select().from(qualityGateConfig).where(eq(qualityGateConfig.id, 'global'));
    const threshold = cfg?.passRateThreshold ?? 100;
    const passRate = run.total > 0 ? Math.round((run.passed / run.total) * 100) : 0;

    return reply.send({
      runId: run.id,
      passed: run.gateStatus === 'passed',
      gateStatus: run.gateStatus ?? 'skipped',
      passRate,
      threshold,
    });
  });

  // GET /api/runs — list all runs (most recent first)
  app.get<{ Querystring: { workspaceId?: string; branch?: string; status?: 'running' | 'passed' | 'failed' | 'interrupted'; limit?: string; offset?: string } }>('/api/runs', async (req, reply): Promise<void> => {
    const query = RunsListQuery.safeParse(req.query);
    if (!query.success) return reply.status(400).send({ error: query.error.flatten() });

    const { workspaceId, branch, status, limit, offset } = query.data;
    const conditions = and(
      workspaceId ? eq(runs.workspaceId, workspaceId) : undefined,
      branch ? eq(runs.branch, branch) : undefined,
      status ? eq(runs.status, status) : undefined,
    );

    const allRuns = await db
      .select()
      .from(runs)
      .where(conditions)
      .orderBy(desc(runs.startedAt))
      .limit(limit ?? 200)
      .offset(offset ?? 0);
    return reply.send(allRuns);
  });

  // GET /api/runs/:id — single run detail
  app.get<{ Params: { id: string } }>('/api/runs/:id', async (req, reply): Promise<void> => {
    const [run] = await db.select().from(runs).where(eq(runs.id, req.params.id));
    if (!run) return reply.status(404).send({ error: 'Run not found' });
    return reply.send(run);
  });

  // GET /api/runs/:id/report.html — download standalone HTML report
  app.get<{ Params: { id: string } }>('/api/runs/:id/report.html', async (req, reply): Promise<void> => {
    try {
      const html = await generateHtmlReport(req.params.id);
      return reply
        .header('Content-Type', 'text/html; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="run-${req.params.id.slice(0, 8)}-report.html"`)
        .send(html);
    } catch (err) {
      return reply.status(404).send({ error: (err as Error).message });
    }
  });

  // GET /api/runs/:id/report.pdf — download PDF report
  app.get<{ Params: { id: string } }>('/api/runs/:id/report.pdf', async (req, reply): Promise<void> => {
    try {
      const pdf = await generateRunPdf(req.params.id);
      return reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `attachment; filename="run-${req.params.id.slice(0, 8)}-report.pdf"`)
        .send(pdf);
    } catch (err) {
      return reply.status(404).send({ error: (err as Error).message });
    }
  });

  // GET /api/runs/:id/report/:template — download stakeholder-specific PDF report
  // Templates: release (PM/EM), quality (QA Lead), executive (Exec)
  app.get<{ Params: { id: string; template: string } }>(
    '/api/runs/:id/report/:template',
    async (req, reply): Promise<void> => {
      const { template } = req.params;
      if (!VALID_TEMPLATES.includes(template as (typeof VALID_TEMPLATES)[number])) {
        return reply.status(400).send({
          error: `Invalid template '${template}'. Must be one of: ${VALID_TEMPLATES.join(', ')}`,
        });
      }
      try {
        const pdf = await generateStakeholderReport(
          req.params.id,
          template as (typeof VALID_TEMPLATES)[number],
        );
        return reply
          .header('Content-Type', 'application/pdf')
          .header('Content-Disposition', `attachment; filename="run-${req.params.id.slice(0, 8)}-${template}-report.pdf"`)
          .send(pdf);
      } catch (err) {
        return reply.status(404).send({ error: (err as Error).message });
      }
    },
  );

  // DELETE /api/runs/:id — abort a running run
  app.delete<{ Params: { id: string } }>('/api/runs/:id', async (req, reply): Promise<void> => {
    const aborted = runner.abortRun(req.params.id);
    if (!aborted) return reply.status(404).send({ error: 'Run not found or already complete' });
    return reply.send({ aborted: true });
  });

  // POST /api/runs/trigger — alias for POST /api/runs (used by onboarding & bulk actions)
  app.post('/api/runs/trigger', async (req, reply): Promise<void> => {
    const body = StartRunBody.safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() });
    const runId = await runner.startRun(body.data, bridge);
    return reply.status(201).send({ runId });
  });

  // GET /api/runs/:id/fingerprints — unique error fingerprints for a run
  app.get<{ Params: { id: string } }>('/api/runs/:id/fingerprints', async (req, reply): Promise<void> => {
    const runId = req.params.id;
    const testIdsAgg = isPostgres ? sql`STRING_AGG(test_id, ',')` : sql`GROUP_CONCAT(test_id)`;
    
    const rows = getRows<{ errorMessage: string; count: string | number; testIds: string }>(
      await db.execute(sql`
        SELECT error_message as "errorMessage",
               COUNT(*) as count,
               ${testIdsAgg} as "testIds"
        FROM results
        WHERE run_id = ${runId}
          AND error_message IS NOT NULL
        GROUP BY error_message
        ORDER BY count DESC
      `)
    );

    const groups = rows.map((r) => ({
      fingerprint: r.errorMessage?.slice(0, 80) ?? '',
      count: Number(r.count),
      errorMessage: r.errorMessage,
      testIds: r.testIds ? r.testIds.split(',') : [],
    }));

    return reply.send(groups);
  });

  // GET /api/runs/:id/tests/export.csv — download test results for a run as CSV
  app.get<{ Params: { id: string } }>('/api/runs/:id/tests/export.csv', async (req, reply): Promise<void> => {
    const runId = req.params.id;
    const testRows = getRows<Record<string, unknown>>(
      await db.execute(sql`
        SELECT t.title, t.file, t.status, t.duration_ms,
               t.retry_count, t.tags, t.worker_index,
               r.error_message, r.retry as result_retry
        FROM tests t
        LEFT JOIN results r ON r.test_id = t.id AND r.run_id = t.run_id AND r.retry = 0
        WHERE t.run_id = ${runId}
        ORDER BY t.file, t.title
      `)
    );
    const headers = ['title', 'file', 'status', 'duration_ms', 'retry_count', 'tags', 'worker_index', 'error_message', 'result_retry'];
    const csv = toCsv(testRows, headers);
    return reply
      .header('Content-Type', 'text/csv')
      .header('Content-Disposition', `attachment; filename="run-${req.params.id}-tests.csv"`)
      .send(csv);
  });

  // GET /api/runs/:id/junit.xml — download JUnit XML report for CI/CD tools
  app.get<{ Params: { id: string } }>('/api/runs/:id/junit.xml', async (req, reply): Promise<void> => {
    const runId = req.params.id;

    // Verify run exists
    const [run] = await db.select().from(runs).where(eq(runs.id, runId));
    if (!run) return reply.status(404).send({ error: 'Run not found' });

    // Fetch all tests for this run with their results
    const testRows = getRows<{
      id: string;
      title: string;
      file: string;
      status: string;
      duration_ms: number | null;
      error_message: string | null;
      error_stack: string | null;
    }>(
      await db.execute(sql`
        SELECT t.id, t.title, t.file, t.status, t.duration_ms,
               r.error_message, r.error_stack
        FROM tests t
        LEFT JOIN results r ON r.test_id = t.id AND r.run_id = t.run_id AND r.retry = 0
        WHERE t.run_id = ${runId}
        ORDER BY t.file, t.title
      `)
    );

    // Group tests by file to create testsuite elements
    const fileGroups = new Map<string, typeof testRows>();
    for (const test of testRows) {
      const file = test.file || 'unknown';
      if (!fileGroups.has(file)) fileGroups.set(file, []);
      fileGroups.get(file)!.push(test);
    }

    // Build JUnit XML
    const suites = Array.from(fileGroups.entries()).map(([file, testsInFile]) => ({
      name: file,
      tests: testsInFile.map((test) => ({
        name: test.title,
        classname: test.file || 'unknown',
        time: (test.duration_ms ?? 0) / 1000,
        status: test.status as 'passed' | 'failed' | 'skipped' | 'timedOut',
        errorMessage: test.error_message,
        errorStack: test.error_stack,
      })),
    }));

    const xml = generateJUnitXml(suites);

    return reply
      .type('application/xml')
      .header('Content-Disposition', `attachment; filename="run-${runId}.xml"`)
      .send(xml);
  });

  // GET /api/runs/compare?a=:runIdA&b=:runIdB — semantic diff between two runs
  app.get<{ Querystring: { a: string; b: string } }>('/api/runs/compare', async (req, reply): Promise<void> => {
    const { a, b } = req.query;
    if (!a || !b) return reply.status(400).send({ error: 'Both ?a= and ?b= are required' });

    type TestRow = { stable_id: string | null; title: string; file: string; status: string; duration_ms: number | null };
    const testsA = getRows<TestRow>(
      await db.execute(sql`SELECT stable_id, title, file, status, duration_ms FROM tests WHERE run_id = ${a}`)
    );
    const testsB = getRows<TestRow>(
      await db.execute(sql`SELECT stable_id, title, file, status, duration_ms FROM tests WHERE run_id = ${b}`)
    );

    const key = (t: TestRow) => t.stable_id ?? `${t.file}::${t.title}`;
    const mapA = new Map(testsA.map((t) => [key(t), t]));
    const mapB = new Map(testsB.map((t) => [key(t), t]));
    const allKeys = new Set([...mapA.keys(), ...mapB.keys()]);
    const PASS = new Set(['passed', 'flaky', 'skipped']);

    type ChangeType = 'new_failure' | 'fixed' | 'regression' | 'unchanged' | 'added' | 'removed';
    const rows: Array<{
      title: string; file: string;
      statusA: string | null; statusB: string | null;
      durationA: number | null; durationB: number | null;
      changeType: ChangeType;
    }> = [];

    for (const k of allKeys) {
      const ta = mapA.get(k);
      const tb = mapB.get(k);
      const title = (ta ?? tb)!.title;
      const file = (ta ?? tb)!.file;
      const statusA = ta?.status ?? null;
      const statusB = tb?.status ?? null;

      let changeType: ChangeType;
      if (!ta) changeType = 'added';
      else if (!tb) changeType = 'removed';
      else if (PASS.has(statusA!) && !PASS.has(statusB!)) changeType = 'new_failure';
      else if (!PASS.has(statusA!) && PASS.has(statusB!)) changeType = 'fixed';
      else if (statusA !== statusB) changeType = 'regression';
      else changeType = 'unchanged';
      rows.push({ title, file, statusA, statusB, durationA: ta?.duration_ms ?? null, durationB: tb?.duration_ms ?? null, changeType });
    }

    const ORDER: Record<string, number> = { new_failure: 0, regression: 1, fixed: 2, removed: 3, added: 4, unchanged: 5 };
    rows.sort((a, b) => (ORDER[a.changeType] ?? 9) - (ORDER[b.changeType] ?? 9));
    return reply.send(rows);
  });
  // GET /api/runs/list — list tests that would run (--list)
  app.get<{ Querystring: { config?: string } }>(
    '/api/runs/list',
    async (req, reply): Promise<void> => {
      const tree = await runner.listTests(req.query.config);
      return reply.send(tree);
    },
  );
}
