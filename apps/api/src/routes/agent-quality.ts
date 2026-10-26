import { gunzipSync } from 'node:zlib';
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod/v4';
import {
  AgentConfigUploadBodySchema,
  EvalDatasetBodySchema,
  EvalDatasetRunBodySchema,
  type HealthUploadResult,
  type OtlpExportResponse,
} from '@automate/shared-contracts';
import { domainErrorResponse } from '../errors/boundary.js';
import { DomainError, ErrorCode } from '../errors/domain-error.js';
import { invalidRequest } from '../http/invalid-request.js';
import { callerOf, requireRole, type CallerResolver } from '../http/roles.js';
import { uploaderActor } from '../http/uploader.js';
import { audit } from '../services/access-service.js';
import {
  ingestAgentConfig,
  listMcpServers,
  type AgentConfigOptions,
} from '../services/agent-config-service.js';
import { evalRunDetail, projectEvals } from '../services/eval-service.js';
import {
  listEvalDatasets,
  prepareDatasetRun,
  upsertEvalDataset,
  type EvalRunnerOptions,
} from '../services/eval-runner.js';
import {
  ingestOtlpTraces,
  projectAgentRuntime,
  selfAgentRuntime,
} from '../services/genai-span-service.js';

/**
 * Agent quality: eval runs and their regression gate, OTLP GenAI traces and the runtime
 * analytics over them, the agent-config scan's MCP inventory, and the built-in eval runner.
 *
 * Eval reports are uploaded through **the** health upload door (`POST /health/reports` with
 * `format=promptfoo-json|deepeval-json|inspect-eval-json|automate-eval-json`); this group
 * reads them. Every write here is audited with counts, never content.
 */
export interface AgentQualityRouteOptions extends AgentConfigOptions, EvalRunnerOptions {
  access: CallerResolver;
  /** The health upload's guard (`http/uploader.ts`), shared rather than rebuilt. */
  uploader: MiddlewareHandler;
  /**
   * The same guard with a reporter secret required in every environment: the OTLP receiver
   * is a network-exposed write and is never open, even on a development install.
   */
  otlpUploader: MiddlewareHandler;
  /** Runs a started eval in the background. Injected so a test can await it. */
  schedule?: (task: () => Promise<void>) => void;
  /** Where a background eval failure is reported beyond its audit row. */
  onRunFailure?: (error: unknown) => void;
}

/** One OTLP export: 8 MiB, decompressed. An exporter batches far below this. */
export const OTLP_MAX_BYTES = 8 * 1024 * 1024;
/** One agent-config upload: up to 200 files, but rarely more than a few hundred kB. */
export const AGENT_CONFIG_MAX_BYTES = 4 * 1024 * 1024;
const DATASET_MAX_BYTES = 2 * 1024 * 1024;

const BranchQuerySchema = z.object({ branch: z.string().trim().min(1).max(255).optional() });
const RuntimeQuerySchema = z.object({ days: z.coerce.number().int().min(1).max(90).default(7) });

const limit = (maxSize: number, what: string) =>
  bodyLimit({
    maxSize,
    onError: (context) =>
      domainErrorResponse(
        context,
        new DomainError(
          ErrorCode.PAYLOAD_TOO_LARGE,
          `${what} larger than the ${String(maxSize)}-byte limit`,
        ),
      ),
  });

/** OTLP/HTTP JSON only. Protobuf is refused with a code that says what to send instead. */
const otlpJsonOnly: MiddlewareHandler = async (context, next) => {
  const type = (context.req.header('content-type') ?? '').split(';')[0]?.trim().toLowerCase();
  if (type !== 'application/json') {
    throw new DomainError(
      ErrorCode.UNSUPPORTED_MEDIA_TYPE,
      'This receiver reads OTLP/HTTP JSON only: send Content-Type: application/json (OTEL_EXPORTER_OTLP_TRACES_PROTOCOL=http/json). Protobuf is not accepted.',
      { details: { accepted: ['application/json'], received: type ?? '' } },
    );
  }
  await next();
};

/** The export body, gunzipped when the exporter compressed it, never past the limit. */
async function otlpBody(context: Context): Promise<Uint8Array> {
  const raw = new Uint8Array(await context.req.arrayBuffer());
  const encoding = context.req.header('content-encoding')?.trim().toLowerCase();
  if (encoding === undefined || encoding === '' || encoding === 'identity') return raw;
  if (encoding !== 'gzip') {
    throw new DomainError(
      ErrorCode.UNSUPPORTED_MEDIA_TYPE,
      'Content-Encoding must be gzip or none',
      {
        details: { accepted: ['gzip', 'identity'] },
      },
    );
  }
  try {
    return new Uint8Array(gunzipSync(raw, { maxOutputLength: OTLP_MAX_BYTES }));
  } catch (error) {
    const tooLarge =
      error instanceof RangeError || (error as { code?: string }).code === 'ERR_BUFFER_TOO_LARGE';
    throw new DomainError(
      tooLarge ? ErrorCode.PAYLOAD_TOO_LARGE : ErrorCode.INVALID_REQUEST_BODY,
      tooLarge
        ? 'The decompressed export is larger than the limit'
        : 'The gzip body could not be read',
    );
  }
}

function logRunFailure(error: unknown): void {
  console.error('a background eval run failed', {
    error: error instanceof Error ? error.message : String(error),
  });
}

/**
 * The production scheduler: runs the task now, in the background, and routes a rejection to
 * `onFailure`. The API installs no `unhandledRejection` handler, so a floating promise that
 * rejected would end the process; this one cannot, even when `onFailure` itself throws.
 */
export function backgroundSchedule(
  onFailure: (error: unknown) => void,
): (task: () => Promise<void>) => void {
  return (task) => {
    void task().catch((error: unknown) => {
      try {
        onFailure(error);
      } catch (hookError) {
        logRunFailure(error);
        logRunFailure(hookError);
      }
    });
  };
}

export function createAgentQualityRoutes(options: AgentQualityRouteOptions): Hono {
  const app = new Hono();
  const viewer = requireRole('viewer', options.access);
  const operator = requireRole('operator', options.access);
  const schedule = options.schedule ?? backgroundSchedule(options.onRunFailure ?? logRunFailure);

  // ─── Evals ─────────────────────────────────────────────────────────────────

  app.get('/api/v1/projects/:id/evals', viewer, async (context) => {
    const parsed = BranchQuerySchema.safeParse(context.req.query());
    if (!parsed.success) return invalidRequest(context, 'Invalid evals query', parsed.error.issues);
    return context.json(await projectEvals(options, context.req.param('id'), parsed.data.branch));
  });

  app.get('/api/v1/projects/:id/evals/runs/:runId', viewer, async (context) =>
    context.json(await evalRunDetail(options, context.req.param('id'), context.req.param('runId'))),
  );

  // ─── OTLP traces ───────────────────────────────────────────────────────────

  app.post(
    '/api/v1/projects/:id/otlp/v1/traces',
    options.otlpUploader,
    otlpJsonOnly,
    limit(OTLP_MAX_BYTES, 'Trace export'),
    async (context) => {
      const projectId = context.req.param('id');
      const result = await ingestOtlpTraces(options, projectId, await otlpBody(context));
      await audit(options, {
        actor: await uploaderActor(context, options.access),
        action: 'agents.otlp.ingest',
        resourceType: 'project',
        resourceId: projectId,
        details: { accepted: result.accepted, rejected: result.rejectedSpans },
      });
      const body: OtlpExportResponse = {
        partialSuccess: { rejectedSpans: result.rejectedSpans, errorMessage: result.errorMessage },
      };
      return context.json(body);
    },
  );

  // ─── Runtime ───────────────────────────────────────────────────────────────

  app.get('/api/v1/projects/:id/agents/runtime', viewer, async (context) => {
    const parsed = RuntimeQuerySchema.safeParse(context.req.query());
    if (!parsed.success)
      return invalidRequest(context, 'Invalid runtime window', parsed.error.issues);
    return context.json(
      await projectAgentRuntime(options, context.req.param('id'), parsed.data.days),
    );
  });

  /** The installation's own chat completions: no project, the installation's workspace. */
  app.get('/api/v1/chat/runtime', viewer, async (context) => {
    const parsed = RuntimeQuerySchema.safeParse(context.req.query());
    if (!parsed.success)
      return invalidRequest(context, 'Invalid runtime window', parsed.error.issues);
    return context.json(await selfAgentRuntime(options, parsed.data.days));
  });

  // ─── Agent configuration ───────────────────────────────────────────────────

  app.post(
    '/api/v1/projects/:id/health/agent-config',
    options.uploader,
    limit(AGENT_CONFIG_MAX_BYTES, 'Agent-config upload'),
    async (context) => {
      const parsed = AgentConfigUploadBodySchema.safeParse(
        await context.req.json().catch(() => null),
      );
      if (!parsed.success)
        return invalidRequest(context, 'Invalid agent-config upload', parsed.error.issues);
      const result = await ingestAgentConfig(options, context.req.param('id'), {
        ...parsed.data,
        source: 'ci',
      });
      await audit(options, {
        actor: await uploaderActor(context, options.access),
        action: 'health.agent-config.upload',
        resourceType: 'project',
        resourceId: context.req.param('id'),
        details: {
          branch: result.branch,
          files: result.filesScanned,
          ignored: result.ignored,
          findings: result.findings,
          mcpServers: result.mcpServers,
        },
      });
      return context.json(result, 201);
    },
  );

  app.get('/api/v1/projects/:id/agents/mcp-servers', viewer, async (context) => {
    const parsed = BranchQuerySchema.safeParse(context.req.query());
    if (!parsed.success)
      return invalidRequest(context, 'Invalid inventory query', parsed.error.issues);
    return context.json(await listMcpServers(options, context.req.param('id'), parsed.data.branch));
  });

  // ─── The built-in eval runner ──────────────────────────────────────────────

  app.get('/api/v1/projects/:id/evals/datasets', viewer, async (context) =>
    context.json(await listEvalDatasets(options, context.req.param('id'))),
  );

  app.post(
    '/api/v1/projects/:id/evals/datasets',
    operator,
    limit(DATASET_MAX_BYTES, 'Dataset'),
    async (context) => {
      const parsed = EvalDatasetBodySchema.safeParse(await context.req.json().catch(() => null));
      if (!parsed.success)
        return invalidRequest(context, 'Invalid eval dataset', parsed.error.issues);
      const actor = (await callerOf(context, options.access)).actor;
      const { dataset, created } = await upsertEvalDataset(
        options,
        context.req.param('id'),
        parsed.data,
        actor,
      );
      await audit(options, {
        actor,
        action: created ? 'evals.dataset.create' : 'evals.dataset.replace',
        resourceType: 'eval_dataset',
        resourceId: dataset.id,
        details: {
          name: dataset.name,
          cases: dataset.cases.length,
          repeats: dataset.repeats,
          judge: dataset.judge !== null,
        },
      });
      return context.json(dataset, created ? 201 : 200);
    },
  );

  /** Spends the installation's model budget, so it is operating — the class chat is in. */
  app.post('/api/v1/projects/:id/evals/datasets/:datasetId/run', operator, async (context) => {
    const parsed = EvalDatasetRunBodySchema.safeParse(
      (await context.req.json().catch(() => ({}))) ?? {},
    );
    if (!parsed.success) return invalidRequest(context, 'Invalid eval run', parsed.error.issues);
    const actor = (await callerOf(context, options.access)).actor;
    const prepared = await prepareDatasetRun(
      options,
      context.req.param('id'),
      context.req.param('datasetId'),
      parsed.data,
    );
    const { started } = prepared;
    const record = (action: string, details: Record<string, unknown>) =>
      audit(options, {
        actor,
        action,
        resourceType: 'eval_dataset',
        resourceId: started.datasetId,
        details: { suite: started.suite, branch: started.branch, ...details },
      });
    // `audit` never throws, so nothing between the claim and `schedule` can leak the claim.
    await record('evals.dataset.run.start', { attempts: started.attempts });
    schedule(async () => {
      let result: HealthUploadResult;
      try {
        result = await prepared.execute();
      } catch (error) {
        await record('evals.dataset.run.failed', {
          code: error instanceof DomainError ? error.code : ErrorCode.INTERNAL,
        });
        options.onRunFailure?.(error);
        return;
      }
      await record('evals.dataset.run.complete', {
        reportId: result.reportId,
        metrics: result.metrics,
      });
    });
    return context.json(started, 202);
  });

  return app;
}
