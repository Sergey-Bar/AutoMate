/**
 * ci-gate.ts — CI-agnostic quality gate enforcement REST API.
 *
 * Endpoints:
 *   GET  /api/ci/gate/:runId            Current gate status (machine-parseable)
 *   POST /api/ci/gate/wait/:runId       Long-poll until run completes
 *   GET  /api/ci/gate/latest            Gate status for the most recent matching run
 *
 * All responses include an `exitCode` field: 0 = pass, 1 = fail.
 *
 * Authentication: bypassed for all three endpoints when GATE_PUBLIC=true env var is set.
 * See plugins/auth.ts for the bypass logic.
 */
import type { FastifyInstance } from 'fastify';
import { db } from '../db/client.js';
import { runs, qualityGateConfig, quarantine } from '../db/schema.js';
import { eq, desc, and, sql } from 'drizzle-orm';
import { z } from 'zod';

const WAIT_DEFAULT_TIMEOUT_SECONDS = 300; // 5 minutes
const WAIT_POLL_INTERVAL_MS = Number(process.env.CI_GATE_POLL_MS ?? 1000);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface GateResponse {
  runId: string;
  passed: boolean;
  gateStatus: 'passed' | 'failed' | 'skipped';
  passRate: number;
  threshold: number;
  failedTests: number;
  totalTests: number;
  quarantinedTests: number;
  exitCode: 0 | 1;
}

async function buildGateResponse(runId: string): Promise<GateResponse | null> {
  const [run] = await db.select().from(runs).where(eq(runs.id, runId));
  if (!run) return null;

  // Resolve config: workspace-specific first, then global fallback
  let threshold = 100;
  if (run.workspaceId) {
    const [wsCfg] = await db
      .select()
      .from(qualityGateConfig)
      .where(eq(qualityGateConfig.workspaceId, run.workspaceId));
    if (wsCfg) {
      threshold = wsCfg.passRateThreshold;
    }
  }
  if (threshold === 100) {
    const [globalCfg] = await db
      .select()
      .from(qualityGateConfig)
      .where(eq(qualityGateConfig.id, 'global'));
    if (globalCfg) {
      threshold = globalCfg.passRateThreshold;
    }
  }

  const passRate = run.total > 0 ? Math.round((run.passed / run.total) * 100) : 0;
  const gateStatus = (run.gateStatus ?? 'skipped') as 'passed' | 'failed' | 'skipped';
  const passed = gateStatus === 'passed';

  const [countRow] = await db
    .select({ count: sql<number>`count(*)`.as('count') })
    .from(quarantine)
    .where(eq(quarantine.status, 'approved'));
  const quarantinedTests = countRow?.count ?? 0;

  return {
    runId: run.id,
    passed,
    gateStatus,
    passRate,
    threshold,
    failedTests: run.failed,
    totalTests: run.total,
    quarantinedTests: Number(quarantinedTests),
    exitCode: passed ? 0 : 1,
  };
}

export async function ciGateRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/ci/gate/:runId — current gate status for a specific run
  app.get<{ Params: { runId: string } }>(
    '/api/ci/gate/:runId',
    async (req, reply): Promise<void> => {
      const response = await buildGateResponse(req.params.runId);
      if (!response) {
        void reply.status(404).send({ error: 'Run not found' });
        return;
      }
      void reply.send(response);
    },
  );

  // POST /api/ci/gate/wait/:runId — block until run completes, then return gate status
  const WaitQuerySchema = z.object({
    timeout: z.coerce.number().int().min(1).max(600).optional(),
  });

  app.post<{ Params: { runId: string }; Querystring: z.infer<typeof WaitQuerySchema> }>(
    '/api/ci/gate/wait/:runId',
    async (req, reply): Promise<void> => {
      const query = WaitQuerySchema.safeParse(req.query);
      if (!query.success) {
        void reply.status(400).send({ error: query.error.flatten() });
        return;
      }

      const timeoutMs = (query.data.timeout ?? WAIT_DEFAULT_TIMEOUT_SECONDS) * 1000;
      const deadline = Date.now() + timeoutMs;

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const [run] = await db.select().from(runs).where(eq(runs.id, req.params.runId));

        if (!run) {
          void reply.status(404).send({ error: 'Run not found' });
          return;
        }

        if (run.status !== 'running') {
          const response = await buildGateResponse(run.id);
          void reply.send(response);
          return;
        }

        if (Date.now() >= deadline) {
          void reply.status(408).send({
            error: 'Timeout waiting for run to complete',
            runId: run.id,
            status: run.status,
          });
          return;
        }

        await sleep(WAIT_POLL_INTERVAL_MS);
      }
    },
  );

  // GET /api/ci/gate/latest — gate status for the most recent run matching criteria
  const LatestQuerySchema = z.object({
    workspace: z.string().optional(),
    branch: z.string().optional(),
  });

  app.get<{ Querystring: z.infer<typeof LatestQuerySchema> }>(
    '/api/ci/gate/latest',
    async (req, reply): Promise<void> => {
      const query = LatestQuerySchema.safeParse(req.query);
      if (!query.success) {
        void reply.status(400).send({ error: query.error.flatten() });
        return;
      }

      const { workspace, branch } = query.data;
      const conditions = and(
        workspace ? eq(runs.workspaceId, workspace) : undefined,
        branch ? eq(runs.branch, branch) : undefined,
      );

      const [latestRun] = await db
        .select()
        .from(runs)
        .where(conditions)
        .orderBy(desc(runs.startedAt))
        .limit(1);

      if (!latestRun) {
        void reply.status(404).send({ error: 'No matching run found' });
        return;
      }

      const response = await buildGateResponse(latestRun.id);
      void reply.send(response);
    },
  );
}
