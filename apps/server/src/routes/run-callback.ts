import type { FastifyInstance } from 'fastify';
import { serviceAuthPreHandler } from '../plugins/service-auth.js';
import { triageFailedRun, triageResults } from '../services/ai-triage.js';
import { isEnabled } from '../services/feature-flags.js';

export interface RunResultCallback {
  runId: string;
  status: 'passed' | 'failed' | 'interrupted';
  total: number;
  passed: number;
  failed: number;
  flaky?: number;
  skipped?: number;
  durationMs?: number;
  dashboardUrl?: string;
  failedTests?: Array<{
    title: string;
    file?: string;
    errorMessage?: string;
  }>;
  prNumber?: number;
  prBranch?: string;
  commitAuthor?: string;
}

export const runResults = new Map<string, RunResultCallback>();

async function forwardToDashboard(
  result: RunResultCallback,
  dashboardApiUrl: string,
  serviceSecret: string,
  log: FastifyInstance['log'],
): Promise<void> {
  const forwardedPayload = {
    runId: result.runId,
    status: result.status,
    totalTests: result.total,
    passedTests: result.passed,
    failedTests: result.failed,
    failedTestDetails: result.failedTests,
    prNumber: result.prNumber,
    prBranch: result.prBranch,
    commitAuthor: result.commitAuthor,
  };

  const res = await fetch(`${dashboardApiUrl}/api/run-callback`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-service-secret': serviceSecret,
    },
    body: JSON.stringify(forwardedPayload),
  });

  if (!res.ok) {
    log.warn({ runId: result.runId, status: res.status }, '[run-callback] Dashboard forwarding returned non-OK status');
  }
}

export async function runCallbackRoutes(
  app: FastifyInstance,
  options: { serviceSecret?: string; ollamaHost?: string; model?: string; dashboardApiUrl?: string },
): Promise<void> {
  const { serviceSecret, ollamaHost, model, dashboardApiUrl } = options;

  if (!serviceSecret) {
    app.log.warn('AUTOMATE_SERVICE_SECRET is not set — run-callback routes disabled');
    return;
  }

  app.post('/api/service/run-callback', {
    preHandler: async (request, reply) =>
      serviceAuthPreHandler(request, reply, serviceSecret),
  }, async (request, reply): Promise<void> => {
    const body = request.body as Record<string, unknown>;

    if (!body || typeof body.runId !== 'string' || !body.runId) {
      return reply.code(400).send({ error: 'Missing required field: runId' });
    }

    const validStatuses = ['passed', 'failed', 'interrupted'];
    if (typeof body.status !== 'string' || !validStatuses.includes(body.status)) {
      return reply.code(400).send({ error: 'Invalid or missing field: status' });
    }

    if (typeof body.total !== 'number') {
      return reply.code(400).send({ error: 'Missing required field: total' });
    }

    if (typeof body.passed !== 'number') {
      return reply.code(400).send({ error: 'Missing required field: passed' });
    }

    if (typeof body.failed !== 'number') {
      return reply.code(400).send({ error: 'Missing required field: failed' });
    }

    const result: RunResultCallback = {
      runId: body.runId,
      status: body.status as RunResultCallback['status'],
      total: body.total,
      passed: body.passed,
      failed: body.failed,
      flaky: typeof body.flaky === 'number' ? body.flaky : undefined,
      skipped: typeof body.skipped === 'number' ? body.skipped : undefined,
      durationMs: typeof body.durationMs === 'number' ? body.durationMs : undefined,
      dashboardUrl: typeof body.dashboardUrl === 'string' ? body.dashboardUrl : undefined,
      failedTests: Array.isArray(body.failedTests)
        ? (body.failedTests as Array<Record<string, unknown>>).map((t) => ({
            title: typeof t.title === 'string' ? t.title : '',
            file: typeof t.file === 'string' ? t.file : undefined,
            errorMessage: typeof t.errorMessage === 'string' ? t.errorMessage : undefined,
          }))
        : undefined,
      prNumber: typeof body.prNumber === 'number' ? body.prNumber : undefined,
      prBranch: typeof body.prBranch === 'string' ? body.prBranch : undefined,
      commitAuthor: typeof body.commitAuthor === 'string' ? body.commitAuthor : undefined,
    };

    runResults.set(result.runId, result);

    if (isEnabled('ai-triage') && result.failed > 0 && (result.failedTests?.length ?? 0) > 0) {
      triageFailedRun(result, { ollamaHost, model }).catch((err: unknown) => {
        console.error('Triage failed:', err instanceof Error ? err.message : String(err));
      });
    }

    // Forward to Dashboard if configured — failure must not affect the 200 response
    if (dashboardApiUrl && serviceSecret) {
      forwardToDashboard(result, dashboardApiUrl, serviceSecret, app.log).catch((err: unknown) => {
        app.log.warn(
          { runId: result.runId, err: err instanceof Error ? err.message : String(err) },
          '[run-callback] Failed to forward result to Dashboard',
        );
      });
    }

    return reply.code(200).send({ received: true });
  });

  app.get('/api/service/run-results/:runId', {
    preHandler: async (request, reply) =>
      serviceAuthPreHandler(request, reply, serviceSecret),
  }, async (request, reply): Promise<void> => {
    const { runId } = request.params as { runId: string };
    const result = runResults.get(runId);

    if (!result) {
      return reply.code(404).send({ error: 'Run result not found' });
    }

    return reply.code(200).send(result);
  });

  app.get('/api/service/run-triage/:runId', {
    preHandler: async (request, reply) =>
      serviceAuthPreHandler(request, reply, serviceSecret),
  }, async (request, reply): Promise<void> => {
    const { runId } = request.params as { runId: string };

    const triage = triageResults.get(runId);
    if (triage) {
      return reply.code(200).send(triage);
    }

    // Check if triage is pending: run exists with failures but triage not done yet
    const runResult = runResults.get(runId);
    if (runResult && runResult.failed > 0) {
      return reply.code(202).send({ status: 'pending', message: 'Triage in progress' });
    }

    return reply.code(404).send({ error: 'Triage result not found' });
  });
}
