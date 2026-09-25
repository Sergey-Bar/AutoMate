import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { Hono, type Context } from 'hono';
import { z } from 'zod/v4';
import type { RunRecord, RunRepository } from '../repositories/run-repository.js';
import type { CanonicalRealtimeEvent, RealtimeBus } from '../realtime/realtime-bus.js';
import { createGateEvaluation, defaultPolicy } from '../execution/quality-gate.js';
import { listIntegrationMaturity } from '../execution/maturity.js';
import { createRunnerToken, hashRunnerToken } from '../execution/in-memory-execution-store.js';
import { toCanonicalRun } from '../execution/canonical.js';
import type {
  ArtifactKind,
  CreateRunInput,
  DomainName,
  ExecutionEventInput,
  ExecutionRun,
  ExecutionStore,
  JobCompletionInput,
  QualityPolicy,
  RunPhase,
} from '../execution/types.js';

const CreateRunSchema = z
  .object({
    externalId: z.string().min(1).nullable().optional(),
    source: z.string().min(1).optional(),
    framework: z.string().min(1).optional(),
    adapterVersion: z.string().min(1).optional(),
    testType: z.string().min(1).optional(),
    projectId: z.string().min(1).optional(),
    environmentId: z.string().min(1).optional(),
    releaseId: z.string().min(1).optional(),
    branch: z.string().optional(),
    commit: z.string().optional(),
    suite: z.string().optional(),
    selection: z
      .union([
        z.array(z.string()),
        z.object({
          testIds: z.array(z.string()).default([]),
          paths: z.array(z.string()).default([]),
          tags: z.array(z.string()).default([]),
        }),
      ])
      .optional(),
    timeoutMs: z.number().int().positive().max(86_400_000).optional(),
    priority: z.number().int().optional(),
    requiredCapabilities: z.array(z.string().min(1)).optional(),
    labels: z.array(z.string().min(1)).optional(),
    configuration: z.record(z.string(), z.unknown()).optional(),
    policyId: z.string().min(1).optional(),
    idempotencyKey: z.string().min(1).optional(),
  })
  .passthrough();

const PolicySchema = z
  .object({
    name: z.string().min(1).default('Universal QA policy'),
    version: z.string().min(1).default('1'),
    requiredDomains: z
      .array(
        z.enum(['browser', 'api', 'mobile', 'performance', 'security', 'accessibility', 'other']),
      )
      .default(['browser']),
    browserPassRateThreshold: z.number().min(0).max(100).default(100),
    maxFlakyRate: z.number().min(0).max(100).default(0),
    maxDurationMs: z.number().int().nonnegative().nullable().optional().default(null),
    rules: z
      .array(
        z.object({
          domain: z.enum([
            'browser',
            'api',
            'mobile',
            'performance',
            'security',
            'accessibility',
            'other',
          ]),
          required: z.boolean().default(false),
          minimumPassRate: z.number().min(0).max(100).optional(),
          requiredArtifactKinds: z.array(z.string()).default([]),
        }),
      )
      .default([]),
  })
  .passthrough();

const RegistrationSchema = z
  .object({
    runnerId: z.string().min(1).optional(),
    name: z.string().min(1).default('runner'),
    version: z.string().min(1).default('unknown'),
    os: z.string().min(1).default(process.platform),
    arch: z.string().min(1).default(process.arch),
    capabilities: z.array(z.string().min(1)).default([]),
    labels: z.array(z.string().min(1)).default([]),
    slots: z.number().int().positive().max(1000).default(1),
    manifest: z
      .object({
        id: z.string().min(1).optional(),
        name: z.string().min(1).optional(),
        version: z.string().min(1).optional(),
        os: z.string().min(1).optional(),
        arch: z.string().min(1).optional(),
        capabilities: z.array(z.string().min(1)).optional(),
        labels: z.array(z.string().min(1)).optional(),
        slots: z.number().int().positive().max(1000).optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

const HeartbeatSchema = z
  .object({
    activeJobIds: z.array(z.string().min(1)).optional(),
    activeJobs: z.array(z.string().min(1)).optional(),
    health: z.enum(['healthy', 'degraded', 'draining', 'offline']).optional(),
    leaseId: z.string().min(1).optional(),
    metrics: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

const ClaimSchema = z
  .object({
    capabilities: z.array(z.string().min(1)).optional(),
    requiredCapabilities: z.array(z.string().min(1)).optional(),
    labels: z.array(z.string().min(1)).optional(),
  })
  .passthrough();

const EventSchema = z
  .object({
    eventId: z.string().min(1),
    sequence: z.number().int().positive(),
    type: z.string().min(1),
    occurredAt: z.string().datetime({ offset: true }).optional(),
    payload: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

const EventBatchSchema = z
  .object({
    jobId: z.string().min(1).optional(),
    runId: z.string().min(1).optional(),
    leaseId: z.string().min(1).optional(),
    fencingToken: z.number().int().positive().optional(),
    events: z.array(EventSchema).min(1),
    nextSequence: z.number().int().positive().optional(),
    terminal: z.boolean().optional(),
    sentAt: z.string().min(1).optional(),
  })
  .passthrough();

const ArtifactSchema = z
  .object({
    name: z.string().min(1),
    kind: z.string().min(1).default('raw'),
    contentType: z.string().min(1).default('application/octet-stream'),
    bytesBase64: z.string().optional(),
    contentBase64: z.string().optional(),
    bytes: z.string().optional(),
    leaseId: z.string().min(1).optional(),
    fencingToken: z.number().int().positive().optional(),
    checksum: z
      .string()
      .regex(/^[a-f0-9]{64}$/iu)
      .optional(),
    sizeBytes: z.number().int().nonnegative().optional(),
    testId: z.string().min(1).nullable().optional(),
    expiresAt: z.string().min(1).nullable().optional(),
    legalHold: z.boolean().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

const CompleteSchema = z
  .object({
    jobId: z.string().min(1).optional(),
    runId: z.string().min(1).optional(),
    attempt: z.number().int().positive().optional(),
    leaseId: z.string().min(1),
    fencingToken: z.number().int().positive(),
    status: z.string().min(1).optional(),
    phase: z
      .enum([
        'queued',
        'assigned',
        'preparing',
        'running',
        'collecting',
        'normalizing',
        'analyzing',
        'gate_evaluation',
        'complete',
        'completed',
        'cancelled',
        'timed_out',
        'runner_lost',
        'infra_failed',
        'config_failed',
        'blocked',
        'partial',
      ])
      .optional(),
    outcome: z
      .enum([
        'passed',
        'failed',
        'unknown',
        'partial',
        'cancelled',
        'timed_out',
        'runner_lost',
        'infra_failed',
        'config_failed',
        'blocked',
      ])
      .nullable()
      .optional(),
    summary: z.record(z.string(), z.unknown()).optional(),
    tests: z
      .array(
        z.object({
          id: z.string().min(1).optional(),
          testId: z.string().min(1).optional(),
          title: z.string().default(''),
          file: z.string().nullable().optional(),
          status: z.enum([
            'queued',
            'running',
            'passed',
            'failed',
            'flaky',
            'skipped',
            'blocked',
            'unknown',
            'cancelled',
            'timed_out',
          ]),
          durationMs: z.number().nonnegative().nullable().optional(),
          error: z
            .object({ code: z.string().optional(), message: z.string() })
            .nullable()
            .optional(),
        }),
      )
      .optional(),
    error: z.object({ code: z.string().optional(), message: z.string() }).nullable().optional(),
  })
  .passthrough();

export interface ExecutionRoutesOptions {
  store: ExecutionStore;
  legacyRepository?: RunRepository;
  workspaceId?: string;
  runnerRegistrationSecret?: string;
  registrationSecret?: string;
  requireIdempotencyKey?: boolean;
  bus?: RealtimeBus;
}

function workspace(options: ExecutionRoutesOptions): string {
  return options.workspaceId ?? 'default-workspace';
}

function requestId(c: Context): string {
  return c.req.header('x-request-id') ?? randomUUID();
}

function error(
  c: Context,
  status: 400 | 401 | 403 | 404 | 409 | 413 | 422 | 500 | 503,
  code: string,
  message: string,
  details?: Record<string, unknown>,
): Response {
  return c.json(
    { error: { code, message, requestId: requestId(c), details: details ?? {} } },
    status,
  );
}

function parseBody<T>(c: Context, schema: z.ZodType<T>): Promise<T | null> {
  return c.req
    .json()
    .then((body) => schema.safeParse(body))
    .then((result) => (result.success ? result.data : null))
    .catch(() => null);
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function registrationAuthorized(c: Context, secret: string | undefined): boolean {
  if (secret === undefined) return process.env['NODE_ENV'] !== 'production';
  const provided =
    c.req.header('x-runner-registration-secret') ?? bearer(c.req.header('authorization'));
  return provided !== undefined && safeEqual(provided, secret);
}

function bearer(value: string | undefined): string | undefined {
  if (!value?.startsWith('Bearer ')) return undefined;
  const token = value.slice(7).trim();
  return token.length > 0 ? token : undefined;
}

async function authenticate(c: Context, store: ExecutionStore) {
  const token = bearer(c.req.header('authorization'));
  if (!token) return null;
  return store.authenticateRunner(token);
}

function legacyRun(record: RunRecord): ExecutionRun {
  const now = new Date().toISOString();
  const phase: RunPhase =
    record.status === 'passed' || record.status === 'failed'
      ? 'complete'
      : record.status === 'interrupted'
        ? 'partial'
        : 'running';
  const outcome =
    record.status === 'passed'
      ? 'passed'
      : record.status === 'failed'
        ? 'failed'
        : record.status === 'interrupted'
          ? 'partial'
          : null;
  return {
    id: record.id,
    externalId: record.id,
    source: 'legacy-reporter',
    framework: 'unknown',
    adapterVersion: 'legacy-1',
    testType: 'unknown',
    projectId: null,
    environmentId: null,
    releaseId: null,
    branch: record.branch,
    commit: record.commitSha,
    suite: null,
    selection: [],
    timeoutMs: 30 * 60_000,
    priority: 0,
    requiredCapabilities: [],
    labels: [],
    configuration: {},
    metadata: {},
    policyId: null,
    idempotencyKey: `legacy:${record.id}`,
    workspaceId: 'default-workspace',
    attempt: 1,
    retryOfRunId: null,
    phase,
    outcome,
    createdAt: record.startedAt,
    updatedAt: record.finishedAt ?? record.startedAt ?? now,
    startedAt: record.startedAt,
    completedAt: record.finishedAt,
    runner: null,
    tests: [],
    summary: {
      total: record.total,
      passed: record.passed,
      failed: record.failed,
      flaky: record.flaky,
      skipped: record.skipped,
      blocked: 0,
      unknown: Math.max(
        0,
        record.total - record.passed - record.failed - record.flaky - record.skipped,
      ),
      durationMs: record.durationMs,
    },
    error: null,
    rawEvidenceRefs: [],
    artifacts: [],
    policyEvaluation: null,
    status: record.status,
  };
}

async function ensurePolicy(store: ExecutionStore, workspaceId: string): Promise<QualityPolicy> {
  const policies = await store.listPolicies(workspaceId);
  if (policies[0]) return policies[0];
  const input = defaultPolicy(workspaceId);
  return store.createPolicy(input);
}

function safeName(value: string): string {
  const base = path.basename(value.replaceAll('\\', '/'));
  return base.replace(/[^a-zA-Z0-9._-]/g, '_') || 'artifact';
}

/**
 * `getArtifact` returns null both when the artifact row is gone and when its
 * bytes cannot be read. Reporting the second case as 404 turns a storage
 * failure into "this evidence never existed"; answer 503 instead so a missing
 * row and unreadable evidence stay distinguishable. Stores without the
 * optional descriptor lookup fall back to 404.
 */
async function missingArtifact(
  c: Context,
  store: ExecutionStore,
  artifactId: string,
  runId?: string,
): Promise<Response> {
  const descriptor = await store.getArtifactDescriptor?.(artifactId);
  if (descriptor && (!runId || descriptor.runId === runId)) {
    return error(
      c,
      503,
      'ARTIFACT_BYTES_UNAVAILABLE',
      'Artifact metadata exists but its bytes are unavailable',
      {
        artifactId: descriptor.id,
        runId: descriptor.runId,
        storageKey: descriptor.storageKey,
        expectedSizeBytes: descriptor.sizeBytes,
        checksum: descriptor.checksum,
      },
    );
  }
  return error(c, 404, 'ARTIFACT_NOT_FOUND', 'Artifact not found');
}

function artifactKind(value: string): string {
  const normalized = value.toLowerCase();
  if (normalized === 'raw_report' || normalized === 'report') return 'report';
  if (normalized === 'playwright-json' || normalized === 'json') return 'json';
  if (normalized === 'junit') return 'junit';
  if (normalized === 'stdout') return 'stdout';
  if (normalized === 'stderr') return 'stderr';
  if (normalized === 'screenshot') return 'screenshot';
  if (normalized === 'video') return 'video';
  if (normalized === 'trace') return 'trace';
  if (normalized === 'html' || normalized === 'html-report') return 'html';
  if (normalized === 'log' || normalized === 'event-log') return 'log';
  return 'other';
}

function domainStatusesFromRun(
  run: ExecutionRun,
): Partial<
  Record<
    DomainName,
    'passed' | 'failed' | 'warning' | 'unknown' | 'not_configured' | 'not_implemented'
  >
> {
  if (run.outcome === 'passed') return { browser: 'passed' };
  if (run.outcome === 'failed') return { browser: 'failed' };
  if (run.outcome === 'partial') return { browser: 'warning' };
  return { browser: 'unknown' };
}

function publishCanonical(
  bus: RealtimeBus | undefined,
  event: Omit<CanonicalRealtimeEvent, 'version' | 'sequence'>,
  sequences: Map<string, number>,
): void {
  const sequence = (sequences.get(event.runId) ?? 0) + 1;
  sequences.set(event.runId, sequence);
  bus?.publish({ version: '1', sequence, ...event });
}

export function createExecutionRoutes(options: ExecutionRoutesOptions): Hono {
  const app = new Hono();
  const ws = workspace(options);
  const eventSequences = new Map<string, number>();

  app.post('/api/v1/runs', async (c) => {
    const parsed = await parseBody(c, CreateRunSchema);
    if (!parsed) return error(c, 400, 'INVALID_RUN', 'Run request is invalid');
    const headerKey = c.req.header('idempotency-key');
    const key = headerKey ?? parsed.idempotencyKey;
    const required = options.requireIdempotencyKey ?? process.env['NODE_ENV'] === 'production';
    if (required && !key)
      return error(c, 400, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header is required');
    if (!key)
      return error(c, 400, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header is required');
    const input = {
      ...parsed,
      selection: Array.isArray(parsed.selection)
        ? parsed.selection
        : [
            ...(parsed.selection?.paths ?? []),
            ...(parsed.selection?.testIds ?? []),
            ...(parsed.selection?.tags ?? []),
          ],
    } as CreateRunInput;
    const result = await options.store.createRun(input, key, ws);
    c.header('x-idempotent-replay', String(result.duplicate));
    return c.json(toCanonicalRun(result.run), 202);
  });

  app.get('/api/v1/runs', async (c) => {
    const releaseId = c.req.query('releaseId');
    const runs = await options.store.listRuns(ws, releaseId);
    if (!options.legacyRepository) return c.json(runs.map(toCanonicalRun));
    const legacy = await options.legacyRepository.listRuns();
    const ids = new Set(runs.map((run) => run.id));
    return c.json([
      ...legacy
        .filter((run) => !ids.has(run.id))
        .map((record) => toCanonicalRun(legacyRun(record))),
      ...runs.map(toCanonicalRun),
    ]);
  });

  app.get('/api/v1/runs/:runId/artifacts', async (c) => {
    const runId = c.req.param('runId');
    const run = await options.store.getRun(runId, ws);
    if (!run) return error(c, 404, 'RUN_NOT_FOUND', 'Run not found');
    return c.json(await options.store.listArtifacts(runId));
  });

  app.get('/api/v1/artifacts/:artifactId', async (c) => {
    const artifact = await options.store.getArtifact(c.req.param('artifactId'));
    if (!artifact) return missingArtifact(c, options.store, c.req.param('artifactId'));
    const headers: Record<string, string> = {
      'content-type': artifact.contentType,
      'content-length': String(artifact.sizeBytes),
      'x-artifact-checksum': artifact.checksum,
      'content-disposition': `attachment; filename="${safeName(artifact.name)}"`,
    };
    return new Response(Buffer.from(artifact.bytes), { status: 200, headers });
  });

  app.get('/api/v1/releases/:releaseId/readiness', async (c) => {
    return c.json(await options.store.getReadiness(c.req.param('releaseId'), ws));
  });

  app.get('/api/v1/runs/:runId/gate', async (c) => {
    const runId = c.req.param('runId');
    const run = await options.store.getRun(runId, ws);
    if (!run) return error(c, 404, 'RUN_NOT_FOUND', 'Run not found');
    const policy = run.policyId
      ? await options.store.getPolicy(run.policyId, ws)
      : await ensurePolicy(options.store, ws);
    if (!policy) return error(c, 404, 'POLICY_NOT_FOUND', 'Quality policy not found');
    const evaluation = createGateEvaluation({
      run,
      policy,
      domainStatuses: domainStatusesFromRun(run),
      evaluatedAt: run.completedAt ?? undefined,
    });
    await options.store.saveGate(evaluation);
    publishCanonical(
      options.bus,
      {
        type: 'gate.evaluated',
        eventId: randomUUID(),
        occurredAt: evaluation.evaluatedAt,
        runId: evaluation.runId,
        payload: { evaluation },
      },
      eventSequences,
    );
    return c.json(evaluation);
  });

  app.get('/api/v1/runs/:runId/events', async (c) => {
    const runId = c.req.param('runId');
    const run = await options.store.getRun(runId, ws);
    if (!run) return error(c, 404, 'RUN_NOT_FOUND', 'Run not found');
    const events = await options.store.listEvents(runId);
    return c.json(
      events.map((event) => ({
        version: '1',
        eventId: event.eventId,
        sequence: event.sequence,
        type: [
          'run.queued',
          'run.assigned',
          'run.started',
          'run.phase_changed',
          'test.queued',
          'test.started',
          'test.completed',
          'run.completed',
          'artifact.created',
          'gate.evaluated',
        ].includes(event.type)
          ? event.type
          : 'run.phase_changed',
        occurredAt: event.occurredAt,
        runId: event.runId,
        payload: event.payload,
      })),
    );
  });

  app.post('/api/v1/runs/:runId/cancel', async (c) => {
    const run = await options.store.cancelRun(c.req.param('runId'), ws);
    if (!run) {
      const legacy = options.legacyRepository
        ? await options.legacyRepository.getRun(c.req.param('runId'))
        : null;
      if (!legacy) return error(c, 404, 'RUN_NOT_FOUND', 'Run not found');
      const finishedAt = new Date().toISOString();
      await options.legacyRepository?.patchRun(legacy.id, { status: 'interrupted', finishedAt });
      const updated = (await options.legacyRepository?.getRun(legacy.id)) ?? legacy;
      return c.json(toCanonicalRun(legacyRun(updated)));
    }
    publishCanonical(
      options.bus,
      {
        type: 'run.completed',
        eventId: randomUUID(),
        occurredAt: run.updatedAt,
        runId: run.id,
        payload: {
          phase: run.phase,
          outcome: run.outcome ?? 'cancelled',
          finishedAt: run.updatedAt,
          summary: toCanonicalRun(run).summary,
        },
      },
      eventSequences,
    );
    return c.json(toCanonicalRun(run));
  });

  app.post('/api/v1/runs/:runId/retry', async (c) => {
    const key = c.req.header('idempotency-key');
    const result = await options.store.retryRun(c.req.param('runId'), ws, key);
    if (!result) {
      const legacy = options.legacyRepository
        ? await options.legacyRepository.getRun(c.req.param('runId'))
        : null;
      if (!legacy)
        return error(c, 409, 'RUN_NOT_RETRYABLE', 'Run is not retryable or was not found');
      const created = await options.store.createRun(
        {
          source: 'legacy-retry',
          framework: 'unknown',
          testType: 'unknown',
          branch: legacy.branch ?? undefined,
          commit: legacy.commitSha ?? undefined,
          retryOfRunId: legacy.id,
        },
        key ?? `retry-legacy:${legacy.id}`,
        ws,
      );
      return c.json(toCanonicalRun(created.run), 202);
    }
    c.header('x-idempotent-replay', String(result.duplicate));
    return c.json(toCanonicalRun(result.run), 202);
  });

  app.get('/api/v1/runs/:runId', async (c) => {
    const runId = c.req.param('runId');
    const run = await options.store.getRun(runId, ws);
    if (run) return c.json(toCanonicalRun(run));
    if (options.legacyRepository) {
      const legacy = await options.legacyRepository.getRun(runId);
      if (legacy) return c.json(toCanonicalRun(legacyRun(legacy)));
    }
    return error(c, 404, 'RUN_NOT_FOUND', 'Run not found');
  });

  app.get('/api/v1/quality-policies', async (c) => {
    const policies = await options.store.listPolicies(ws);
    if (policies.length === 0) return c.json([await ensurePolicy(options.store, ws)]);
    return c.json(policies);
  });

  app.post('/api/v1/quality-policies', async (c) => {
    const parsed = await parseBody(c, PolicySchema);
    if (!parsed) return error(c, 400, 'INVALID_POLICY', 'Quality policy is invalid');
    const input = {
      workspaceId: ws,
      name: parsed.name,
      version: parsed.version,
      requiredDomains: parsed.requiredDomains,
      browserPassRateThreshold: parsed.browserPassRateThreshold,
      maxFlakyRate: parsed.maxFlakyRate,
      maxDurationMs: parsed.maxDurationMs,
      rules: parsed.rules as Array<{
        domain: DomainName;
        required: boolean;
        minimumPassRate?: number;
        requiredArtifactKinds: ArtifactKind[];
      }>,
    };
    const policy = await options.store.createPolicy(input);
    return c.json(policy, 201);
  });

  app.get('/api/v1/integrations/maturity', (c) =>
    c.json({ registryVersion: '1', integrations: listIntegrationMaturity() }),
  );

  app.get('/api/v1/runs/:runId/artifacts/:artifactId', async (c) => {
    const runId = c.req.param('runId');
    const artifactId = c.req.param('artifactId');
    const artifact = await options.store.getArtifact(artifactId);
    if (!artifact) return missingArtifact(c, options.store, artifactId, runId);
    if (artifact.runId !== runId)
      return error(c, 404, 'ARTIFACT_NOT_FOUND', 'Artifact not found');
    return new Response(Buffer.from(artifact.bytes), {
      headers: {
        'content-type': artifact.contentType,
        'content-length': String(artifact.bytes.byteLength),
        'content-disposition': `attachment; filename="${safeName(artifact.name)}"`,
        'x-content-sha256': artifact.checksum,
      },
    });
  });

  app.post('/api/v1/runners/register', async (c) => {
    if (
      !registrationAuthorized(c, options.runnerRegistrationSecret ?? options.registrationSecret)
    ) {
      return error(
        c,
        401,
        'RUNNER_REGISTRATION_UNAUTHORIZED',
        'Runner registration secret is invalid',
      );
    }
    const parsed = await parseBody(c, RegistrationSchema);
    if (!parsed) return error(c, 400, 'INVALID_RUNNER_MANIFEST', 'Runner manifest is invalid');
    const manifest = (parsed.manifest ?? parsed) as {
      id?: string;
      name?: string;
      version?: string;
      os?: string;
      arch?: string;
      capabilities?: string[];
      labels?: string[];
      slots?: number;
    };
    const runnerId = parsed.runnerId ?? manifest.id ?? randomUUID();
    const token = createRunnerToken();
    const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
    const capabilitiesInput = manifest.capabilities ?? parsed.capabilities;
    const capabilities =
      capabilitiesInput && capabilitiesInput.length > 0 ? capabilitiesInput : ['generic'];
    const runner = await options.store.registerRunner(
      {
        id: runnerId,
        name: manifest.name ?? 'runner',
        version: manifest.version ?? 'unknown',
        os: manifest.os ?? process.platform,
        arch: manifest.arch ?? process.arch,
        capabilities,
        labels: manifest.labels ?? parsed.labels,
        slots: manifest.slots ?? parsed.slots,
      },
      hashRunnerToken(token),
      expiresAt,
      ws,
    );
    return c.json(
      {
        runnerId: runner.id,
        token,
        expiresAt,
        manifest: {
          id: runner.id,
          name: runner.name,
          version: runner.version,
          os: runner.os,
          arch: runner.arch,
          capabilities: runner.capabilities,
          labels: runner.labels,
          slots: runner.slots,
        },
      },
      201,
    );
  });

  app.post('/api/v1/runners/:runnerId/heartbeat', async (c) => {
    const runner = await authenticate(c, options.store);
    if (!runner || runner.id !== c.req.param('runnerId'))
      return error(c, 401, 'RUNNER_UNAUTHORIZED', 'Runner token is invalid');
    const parsed = await parseBody(c, HeartbeatSchema);
    if (!parsed) return error(c, 400, 'INVALID_HEARTBEAT', 'Runner heartbeat is invalid');
    const heartbeat = await options.store.heartbeatRunner(
      runner.id,
      parsed.activeJobIds ?? parsed.activeJobs ?? [],
      parsed.health,
    );
    if (!heartbeat) return error(c, 404, 'RUNNER_NOT_FOUND', 'Runner not found');
    return c.json(heartbeat);
  });

  app.post('/api/v1/runners/:runnerId/jobs/claim', async (c) => {
    const runner = await authenticate(c, options.store);
    if (!runner || runner.id !== c.req.param('runnerId'))
      return error(c, 401, 'RUNNER_UNAUTHORIZED', 'Runner token is invalid');
    const parsed = await parseBody(c, ClaimSchema);
    if (!parsed) return error(c, 400, 'INVALID_CLAIM', 'Runner claim is invalid');
    const job = await options.store.claimJob(
      runner.id,
      parsed.capabilities ?? parsed.requiredCapabilities,
      parsed.labels,
    );
    if (!job) return c.body(null, 204);
    return c.json(job);
  });

  const handleEvents = async (c: Context): Promise<Response> => {
    const runner = await authenticate(c, options.store);
    if (!runner) return error(c, 401, 'RUNNER_UNAUTHORIZED', 'Runner token is invalid');
    const body = await c.req.json().catch(() => null);
    const parsed = Array.isArray(body) ? null : EventBatchSchema.safeParse(body);
    if (!parsed?.success) return error(c, 400, 'INVALID_EVENT_BATCH', 'Event batch is invalid');
    const jobId = c.req.param('jobId');
    if (!jobId) return error(c, 400, 'INVALID_JOB_ID', 'Job id is required');
    const batch = parsed.data as {
      leaseId?: string;
      fencingToken?: number;
      events: ExecutionEventInput[];
    };
    const job = await options.store.getJob(jobId);
    const leaseId = batch.leaseId ?? job?.leaseId;
    const fencingToken = batch.fencingToken ?? job?.fencingToken;
    if (!leaseId || !fencingToken)
      return error(c, 409, 'JOB_LEASE_INVALID', 'Job lease is required');
    const results = await options.store.appendEvents(jobId, leaseId, fencingToken, batch.events);
    if (job) {
      for (const [index, result] of results.entries()) {
        if (result.status !== 'accepted') continue;
        const input = batch.events[index];
        if (!input) continue;
        const type = input.type === 'run.phase' ? 'run.phase_changed' : input.type;
        if (
          ![
            'run.queued',
            'run.assigned',
            'run.started',
            'run.phase_changed',
            'test.queued',
            'test.started',
            'test.completed',
            'run.completed',
            'artifact.created',
            'gate.evaluated',
          ].includes(type)
        )
          continue;
        publishCanonical(
          options.bus,
          {
            type: type as CanonicalRealtimeEvent['type'],
            eventId: input.eventId,
            occurredAt: input.occurredAt ?? new Date().toISOString(),
            runId: job.runId,
            payload: input.payload ?? {},
          },
          eventSequences,
        );
      }
    }
    if (results.some((result) => result.status === 'conflict'))
      return c.json({ results, duplicate: false }, 409);
    return c.json(
      {
        results,
        duplicate: results.length > 0 && results.every((result) => result.status === 'duplicate'),
      },
      202,
    );
  };
  app.post('/api/v1/jobs/:jobId/events', handleEvents);
  app.post('/api/v1/jobs/:jobId/events/batch', handleEvents);

  app.post('/api/v1/jobs/:jobId/artifacts', async (c) => {
    const runner = await authenticate(c, options.store);
    if (!runner) return error(c, 401, 'RUNNER_UNAUTHORIZED', 'Runner token is invalid');
    const parsed = await parseBody(c, ArtifactSchema);
    if (!parsed) return error(c, 400, 'INVALID_ARTIFACT', 'Artifact metadata is invalid');
    const job = await options.store.getJob(c.req.param('jobId'));
    if (!job || job.leaseOwner !== runner.id || !job.leaseId)
      return error(c, 409, 'JOB_LEASE_INVALID', 'Job lease is not owned by runner');
    if (parsed.leaseId !== undefined && parsed.leaseId !== job.leaseId)
      return error(c, 409, 'JOB_LEASE_INVALID', 'Job lease is stale');
    if (parsed.fencingToken !== undefined && parsed.fencingToken !== job.fencingToken)
      return error(c, 409, 'JOB_FENCING_STALE', 'Job fencing token is stale');
    const encoded = parsed.bytesBase64 ?? parsed.contentBase64 ?? parsed.bytes;
    let bytes = new Uint8Array();
    if (encoded) {
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || encoded.length % 4 !== 0)
        return error(c, 400, 'INVALID_ARTIFACT_BYTES', 'Artifact bytes are invalid');
      try {
        bytes = new Uint8Array(Buffer.from(encoded, 'base64'));
      } catch {
        return error(c, 400, 'INVALID_ARTIFACT_BYTES', 'Artifact bytes are invalid');
      }
    }
    const name = safeName(parsed.name);
    const checksum = createHash('sha256').update(bytes).digest('hex');
    if (parsed.checksum !== undefined && parsed.checksum.toLowerCase() !== checksum)
      return error(c, 400, 'ARTIFACT_CHECKSUM_MISMATCH', 'Artifact checksum does not match bytes');
    if (parsed.sizeBytes !== undefined && parsed.sizeBytes !== bytes.byteLength)
      return error(c, 400, 'ARTIFACT_SIZE_MISMATCH', 'Artifact size does not match bytes');
    try {
      const descriptor = await options.store.addArtifact({
        runId: job.runId,
        jobId: job.id,
        testId: parsed.testId ?? null,
        kind: artifactKind(parsed.kind),
        name,
        contentType: parsed.contentType,
        storageKey: `runs/${job.runId}/${randomUUID()}-${name}`,
        expiresAt: parsed.expiresAt ?? null,
        legalHold: parsed.legalHold ?? false,
        metadata: parsed.metadata ?? {},
        bytes,
      });
      publishCanonical(
        options.bus,
        {
          type: 'artifact.created',
          eventId: randomUUID(),
          occurredAt: descriptor.createdAt,
          runId: job.runId,
          payload: { artifact: descriptor },
        },
        eventSequences,
      );
      return c.json(descriptor, 201);
    } catch {
      return error(c, 400, 'ARTIFACT_STORAGE_FAILED', 'Artifact could not be stored');
    }
  });

  app.post('/api/v1/jobs/:jobId/complete', async (c) => {
    const runner = await authenticate(c, options.store);
    if (!runner) return error(c, 401, 'RUNNER_UNAUTHORIZED', 'Runner token is invalid');
    const parsed = await parseBody(c, CompleteSchema);
    if (!parsed) return error(c, 400, 'INVALID_COMPLETION', 'Job completion is invalid');
    const parsedData = parsed as {
      phase?: string;
      tests?: Array<{ id?: string; testId?: string }>;
    };
    const completion = {
      ...parsedData,
      phase: parsedData.phase === 'completed' ? 'complete' : parsedData.phase,
      tests: parsedData.tests?.map((test) => ({
        ...test,
        id: test.id ?? test.testId ?? randomUUID(),
      })),
    } as JobCompletionInput;
    const result = await options.store.completeJob(c.req.param('jobId'), completion);
    if (!result) return error(c, 409, 'JOB_LEASE_INVALID', 'Job lease or completion is stale');
    publishCanonical(
      options.bus,
      {
        type: 'run.completed',
        eventId: randomUUID(),
        occurredAt: result.run.completedAt ?? new Date().toISOString(),
        runId: result.run.id,
        payload: {
          phase: result.run.phase,
          outcome: result.run.outcome ?? 'unknown',
          finishedAt: result.run.completedAt ?? new Date().toISOString(),
          summary: toCanonicalRun(result.run).summary,
        },
      },
      eventSequences,
    );
    return c.json(toCanonicalRun(result.run), 200);
  });

  return app;
}

export const createExecutionApiRoutes = createExecutionRoutes;
export const createRunnerApiRoutes = createExecutionRoutes;
