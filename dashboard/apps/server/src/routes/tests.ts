import type { FastifyInstance } from 'fastify';
import { execSync } from 'child_process';
import { db } from '../db/client.js';
import { tests, results, runs } from '../db/schema.js';
import { eq, and, desc, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { readTestSource } from '../services/tests-source.js';
import { groupRecentStatuses } from '../services/tests-history.js';
import { analyzeImpact } from '../services/impact-analysis.js';
import { computeStabilityGrade, computeStabilityGradesBatch } from '../services/stability-grades.js';
import { GIT_COMMAND_TIMEOUT_MS } from '../constants.js';
export async function testsRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/runs/:runId/tests — all tests for a run
  app.get<{ Params: { runId: string } }>('/api/runs/:runId/tests', async (req, reply): Promise<void> => {
    const rows = await db
      .select()
      .from(tests)
      .where(eq(tests.runId, req.params.runId));
    return reply.send(rows);
  });

  // GET /api/runs/:runId/tests/:testId — single test + all results
  app.get<{ Params: { runId: string; testId: string } }>(
    '/api/runs/:runId/tests/:testId',
    async (req, reply): Promise<void> => {
      const [test] = await db
        .select()
        .from(tests)
        .where(and(eq(tests.id, req.params.testId), eq(tests.runId, req.params.runId)));
      if (!test) return reply.status(404).send({ error: 'Test not found' });

      const retries = await db
        .select()
        .from(results)
        .where(and(eq(results.testId, req.params.testId), eq(results.runId, req.params.runId)));

      return reply.send({ ...test, results: retries });
    },
  );

  // GET /api/tests/history/:stableId — cross-run history for a stable test identity
  app.get<{ Params: { stableId: string }; Querystring: { limit?: string } }>(
    '/api/tests/history/:stableId',
    async (req, reply): Promise<void> => {
      const limitRaw = parseInt(req.query.limit ?? '20', 10);
      const limit = Math.min(isNaN(limitRaw) ? 20 : limitRaw, 100);

      const rows = await db
        .select({
          id: tests.id,
          runId: tests.runId,
          status: tests.status,
          durationMs: tests.durationMs,
          retryCount: tests.retryCount,
          runStartedAt: runs.startedAt,
          runBranch: runs.branch,
          runCommitSha: runs.commitSha,
        })
        .from(tests)
        .innerJoin(runs, eq(tests.runId, runs.id))
        .where(eq(tests.stableId, req.params.stableId))
        .orderBy(desc(runs.startedAt))
        .limit(limit);

      return reply.send(rows);
    },
  );

  // POST /api/tests/history/batch — batch-fetch last N statuses for multiple tests
  const BatchHistorySchema = z.object({
    stableIds: z.array(z.string()).max(100),
  });

  app.post<{ Body: { stableIds: string[] } }>('/api/tests/history/batch', async (req, reply): Promise<void> => {
    const parsed = BatchHistorySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid request body', details: parsed.error });
    }

    const { stableIds } = parsed.data;
    if (stableIds.length === 0) return reply.send({});

    // Single query: get all matching tests with run info, ordered by run date
    const rows = await db
      .select({
        stableId: tests.stableId,
        status: tests.status,
        runStartedAt: runs.startedAt,
      })
      .from(tests)
      .innerJoin(runs, eq(tests.runId, runs.id))
      .where(inArray(tests.stableId, stableIds))
      .orderBy(desc(runs.startedAt));

    // Group by stableId, keep last 7 per test (already sorted newest-first)
    const grouped = groupRecentStatuses(
      rows.map((r) => ({ stableId: r.stableId!, status: r.status })),
      7,
    );

    return reply.send(grouped);
  });

  // POST /api/tests/impacted — analyze test impact from changed files
  const ImpactRequestSchema = z.object({
    changedFiles: z.array(z.string()),
  });

  app.post<{ Body: { changedFiles: string[] } }>('/api/tests/impacted', async (req, reply): Promise<void> => {
    const parsed = ImpactRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid request body', details: parsed.error });
    }

    const { changedFiles } = parsed.data;
    const impactedTests = await analyzeImpact(changedFiles);
    return reply.send(impactedTests);
  });

  // GET /api/tests/git-diff — get changed files from git working tree
  app.get('/api/tests/git-diff', async (_req, reply): Promise<void> => {
    // Safe: commands below are hardcoded strings with no user input
    try {
      const output = execSync('git diff --name-only HEAD', {
        encoding: 'utf-8',
        timeout: GIT_COMMAND_TIMEOUT_MS,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const staged = execSync('git diff --name-only --cached', {
        encoding: 'utf-8',
        timeout: GIT_COMMAND_TIMEOUT_MS,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const files = [...new Set([
        ...output.split('\n').filter(Boolean),
        ...staged.split('\n').filter(Boolean),
      ])];
      return reply.send({ changedFiles: files });
    } catch {
      return reply.send({ changedFiles: [] });
    }
  });

  // GET /api/tests/source — read test source file with surrounding context
  app.get<{ Querystring: { file: string; line?: string } }>('/api/tests/source', async (req, reply): Promise<void> => {
    const { file, line: lineStr } = req.query;
    if (!file) {
      return reply.status(400).send({ error: 'Missing file query parameter' });
    }

    const line = lineStr ? parseInt(lineStr, 10) : undefined;
    const result = readTestSource({ file, line });

    if (!result.success) {
      const statusMap = {
        'invalid-path': 400,
        'not-found': 404,
        'read-error': 500,
      };
      return reply.status(statusMap[result.error.type]).send({ error: result.error.message });
    }

    return reply.send(result.data);
  });

  // GET /api/tests/stability/:stableId — compute stability grade for a single test
  app.get<{ Params: { stableId: string }; Querystring: { lookback?: string } }>(
    '/api/tests/stability/:stableId',
    async (req, reply): Promise<void> => {
      const lookback = parseInt(req.query.lookback ?? '20', 10);
      const limit = Math.min(isNaN(lookback) ? 20 : lookback, 100);
      const grade = await computeStabilityGrade(req.params.stableId, limit);
      return reply.send(grade);
    },
  );

  // POST /api/tests/stability/batch — batch-fetch stability grades for multiple tests
  const BatchStabilitySchema = z.object({
    stableIds: z.array(z.string()).max(100),
  });

  app.post<{ Body: { stableIds: string[] } }>('/api/tests/stability/batch', async (req, reply): Promise<void> => {
    const parsed = BatchStabilitySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid request body', details: parsed.error });
    }

    const { stableIds } = parsed.data;
    if (stableIds.length === 0) return reply.send({});

    const result = await computeStabilityGradesBatch(stableIds);

    return reply.send(result);
  });
}
