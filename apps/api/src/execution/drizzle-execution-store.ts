import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { and, asc, desc, eq, inArray, isNotNull, sql, type SQL } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import type { PgliteQueryResultHKT } from 'drizzle-orm/pglite';
import {
  DrizzleOutboxRepository,
  type OutboxDatabase,
  artifacts,
  executionJobs,
  gateEvaluations,
  qualityPolicies,
  runEvents,
  runners,
  runs,
  tests,
} from '@automate/db';
import { sanitizeOutboxEnvelope } from '../infrastructure/outbox-sanitizer.js';
import { createGateEvaluation, defaultPolicy } from './quality-gate.js';
import {
  ARTIFACT_BYTE_CAPACITY,
  BoundedByteMap,
  BoundedMap,
  COMPLETION_HASH_CAPACITY,
} from './bounded-map.js';
import { deriveRunState, isRequestablePhase } from './phase-outcome.js';
import type {
  ArtifactDescriptor,
  CreateRunInput,
  CreateRunResult,
  DomainName,
  DomainStatus,
  ExecutionEvent,
  ExecutionEventInput,
  ExecutionJob,
  ExecutionRun,
  ExecutionStore,
  ExecutionStoreOptions,
  ExecutionSummary,
  ExecutionTestResult,
  EventApplyResult,
  GateEvaluation,
  JobClaim,
  JobCompletionInput,
  JobCompletionResult,
  LeaseReapResult,
  QualityPolicy,
  ReleaseReadiness,
  RegisteredRunner,
  RunnerHealth,
  RunnerHeartbeat,
  RunnerManifest,
  RunOutcome,
  RunPhase,
  StoredArtifact,
} from './types.js';

type AnyPgDb =
  | PgDatabase<PgQueryResultHKT, Record<string, unknown>>
  | PgDatabase<PgliteQueryResultHKT, Record<string, unknown>>;

type DbRow = Record<string, unknown>;

export interface ArtifactBytesStore {
  put(storageKey: string, bytes: Uint8Array): Promise<void>;
  get(storageKey: string): Promise<Uint8Array | null>;
}

export interface DrizzleExecutionStoreOptions extends ExecutionStoreOptions {
  db: AnyPgDb;
  workspaceId?: string;
  artifactBytes?: ArtifactBytesStore;
  outboxRetentionHours?: number;
}

const OUTBOX_DEFAULT_RETENTION_HOURS = 24;

interface OutboxAppend {
  workspaceId: string;
  aggregateId: string;
  eventType: string;
  dedupeKey: string;
  occurredAt: Date;
  payload: Record<string, unknown>;
}

function nowDate(options: ExecutionStoreOptions): Date {
  return options.now ? options.now() : new Date();
}

/**
 * Groups rows by a derived key, preserving input order within each group.
 *
 * The child rows come back from Postgres in whatever order the planner chose, so
 * ordering is not preserved by the database; preserving it here keeps the mapped
 * runs identical to what the per-row path produced.
 */
function groupBy<T>(rows: readonly T[], key: (row: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const group = key(row);
    const existing = groups.get(group);
    if (existing === undefined) groups.set(group, [row]);
    else existing.push(row);
  }
  return groups;
}

/**
 * Narrows a job predicate to a workspace. An omitted `workspaceId` stays
 * unscoped on purpose — only internal sweepers may call that way.
 */
function jobScope(predicate: SQL | undefined, workspaceId: string | undefined): SQL | undefined {
  if (predicate === undefined) return undefined;
  if (workspaceId === undefined) return predicate;
  return and(predicate, eq(executionJobs.workspaceId, workspaceId));
}

function iso(value: Date): string {
  return value.toISOString();
}

function stable(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stable(item)).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .filter((key) => object[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stable(object[key])}`)
    .join(',')}}`;
}

function digest(value: unknown): string {
  return createHash('sha256')
    .update(value instanceof Uint8Array ? value : stable(value))
    .digest('hex');
}

function eventDigest(event: ExecutionEventInput): string {
  return digest({
    eventId: event.eventId,
    sequence: event.sequence,
    type: event.type,
    occurredAt: event.occurredAt,
    payload: event.payload ?? {},
  });
}

function tokenMatches(token: string, expectedHash: string): boolean {
  const actual = Buffer.from(digest(token), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function uuidFor(value: string): string {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value))
    return value.toLowerCase();
  const bytes = createHash('sha256').update(value).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function stringValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function numberValue(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function dateIso(value: unknown): string {
  return value instanceof Date
    ? value.toISOString()
    : typeof value === 'string'
      ? value
      : new Date(0).toISOString();
}

function nullableDateIso(value: unknown): string | null {
  return value === null || value === undefined ? null : dateIso(value);
}

function phaseValue(value: unknown): RunPhase {
  return typeof value === 'string' ? (value as RunPhase) : 'queued';
}

function outcomeValue(value: unknown): RunOutcome {
  return typeof value === 'string' ? (value as RunOutcome) : null;
}

function summaryFromRow(row: DbRow): ExecutionSummary {
  return {
    total: numberValue(row['total']),
    passed: numberValue(row['passed']),
    failed: numberValue(row['failed']),
    flaky: numberValue(row['flaky']),
    skipped: numberValue(row['skipped']),
    blocked: numberValue(row['blocked']),
    unknown: numberValue(row['unknown']),
    durationMs:
      row['durationMs'] === null || row['durationMs'] === undefined
        ? null
        : numberValue(row['durationMs']),
  };
}

function dbTestStatus(
  status: ExecutionTestResult['status'],
):
  | 'queued'
  | 'running'
  | 'passed'
  | 'failed'
  | 'flaky'
  | 'skipped'
  | 'timedOut'
  | 'timed_out'
  | 'blocked'
  | 'cancelled'
  | 'unknown' {
  if (status === 'timed_out') return 'timed_out';
  if (
    status === 'queued' ||
    status === 'running' ||
    status === 'passed' ||
    status === 'failed' ||
    status === 'flaky' ||
    status === 'skipped' ||
    status === 'blocked' ||
    status === 'cancelled' ||
    status === 'unknown'
  )
    return status;
  return 'unknown';
}

function mapTest(row: DbRow): ExecutionTestResult {
  const status = stringValue(row['status'], 'unknown');
  return {
    id: stringValue(row['id']),
    title: stringValue(row['title'], 'Untitled test'),
    file: nullableString(row['file']),
    status: (status === 'queued' ||
    status === 'running' ||
    status === 'passed' ||
    status === 'failed' ||
    status === 'flaky' ||
    status === 'skipped' ||
    status === 'blocked' ||
    status === 'unknown' ||
    status === 'cancelled' ||
    status === 'timed_out'
      ? status
      : 'unknown') as ExecutionTestResult['status'],
    durationMs:
      row['durationMs'] === null || row['durationMs'] === undefined
        ? null
        : numberValue(row['durationMs']),
    attempt: numberValue(row['retryCount'], 1) + 1,
  };
}

function mapJob(row: DbRow): ExecutionJob {
  return {
    id: stringValue(row['id']),
    runId: stringValue(row['runId']),
    workspaceId: stringValue(row['workspaceId'], 'default-workspace'),
    attempt: numberValue(row['attempt'], 1),
    priority: numberValue(row['priority']),
    state: stringValue(row['state'], 'queued') as ExecutionJob['state'],
    availableAt: dateIso(row['availableAt']),
    requiredCapabilities: Array.isArray(row['requiredCapabilities'])
      ? row['requiredCapabilities'].filter((value): value is string => typeof value === 'string')
      : [],
    labels: Array.isArray(row['labels'])
      ? row['labels'].filter((value): value is string => typeof value === 'string')
      : [],
    leaseId: nullableString(row['leaseId']),
    leaseOwner: nullableString(row['leaseOwner']),
    leaseExpiresAt: nullableDateIso(row['leaseExpiresAt']),
    fencingToken: numberValue(row['fencingToken']),
    heartbeatAt: nullableDateIso(row['heartbeatAt']),
    idempotencyKey: stringValue(row['idempotencyKey']),
    error:
      row['errorCode'] || row['errorMessage']
        ? {
            code: stringValue(row['errorCode'], 'EXECUTION_ERROR'),
            message: stringValue(row['errorMessage'], 'Execution failed'),
          }
        : null,
    createdAt: dateIso(row['createdAt']),
    updatedAt: dateIso(row['updatedAt']),
  };
}

function mapRunner(row: DbRow): RegisteredRunner {
  return {
    id: stringValue(row['id']),
    name: stringValue(row['name']),
    version: stringValue(row['version']),
    os: stringValue(row['os']),
    arch: stringValue(row['arch']),
    capabilities: Array.isArray(row['capabilities'])
      ? row['capabilities'].filter((value): value is string => typeof value === 'string')
      : [],
    labels: Array.isArray(row['labels'])
      ? row['labels'].filter((value): value is string => typeof value === 'string')
      : [],
    slots: numberValue(row['slots'], 1),
    health: stringValue(row['health'], 'healthy') as RegisteredRunner['health'],
    tokenHash: stringValue(row['tokenHash']),
    tokenExpiresAt: dateIso(row['tokenExpiresAt']),
    lastHeartbeatAt: nullableDateIso(row['lastHeartbeatAt']),
    activeJobIds: [],
    createdAt: dateIso(row['createdAt']),
    updatedAt: dateIso(row['updatedAt']),
  };
}

function mapPolicy(row: DbRow): QualityPolicy {
  const required = (
    Array.isArray(row['requiredDomains'])
      ? row['requiredDomains'].filter((value): value is DomainName => typeof value === 'string')
      : ['browser']
  ) as DomainName[];
  return {
    id: stringValue(row['id']),
    workspaceId: stringValue(row['workspaceId']),
    name: stringValue(row['name']),
    version: stringValue(row['version']),
    hash: stringValue(row['hash']),
    requiredDomains: required,
    browserPassRateThreshold: numberValue(row['browserPassRateThreshold'], 100),
    maxFlakyRate: numberValue(row['maxFlakyRate']),
    maxDurationMs:
      row['maxDurationMs'] === null || row['maxDurationMs'] === undefined
        ? null
        : numberValue(row['maxDurationMs']),
    rules: Array.isArray(row['rules'])
      ? row['rules'].filter(
          (value): value is QualityPolicy['rules'][number] =>
            typeof value === 'object' && value !== null,
        )
      : [],
    createdAt: dateIso(row['createdAt']),
    updatedAt: dateIso(row['updatedAt']),
  };
}

function mapGate(row: DbRow): GateEvaluation {
  const statuses =
    row['domainStatuses'] && typeof row['domainStatuses'] === 'object'
      ? (row['domainStatuses'] as Record<string, string>)
      : {};
  const domains: Record<DomainName, DomainStatus> = {
    browser: (statuses['browser'] as DomainStatus | undefined) ?? 'unknown',
    api: (statuses['api'] as DomainStatus | undefined) ?? 'not_configured',
    mobile: (statuses['mobile'] as DomainStatus | undefined) ?? 'not_configured',
    performance: (statuses['performance'] as DomainStatus | undefined) ?? 'not_configured',
    security: (statuses['security'] as DomainStatus | undefined) ?? 'not_configured',
    accessibility: (statuses['accessibility'] as DomainStatus | undefined) ?? 'not_configured',
    other: (statuses['other'] as DomainStatus | undefined) ?? 'not_configured',
  };
  return {
    id: stringValue(row['id']),
    runId: stringValue(row['runId']),
    releaseId: nullableString(row['releaseId']),
    policyId: stringValue(row['policyId']),
    policyVersion: stringValue(row['policyVersion']),
    policyHash: stringValue(row['policyHash']),
    status: stringValue(row['status'], 'unknown') as GateEvaluation['status'],
    decision: stringValue(row['decision'], 'unknown') as GateEvaluation['decision'],
    reasons: Array.isArray(row['reasons'])
      ? row['reasons'].filter((value): value is string => typeof value === 'string')
      : [],
    evidenceRefs: Array.isArray(row['evidenceRefs'])
      ? row['evidenceRefs'].filter((value): value is string => typeof value === 'string')
      : [],
    domainStatuses: domains,
    evaluatedAt: dateIso(row['evaluatedAt']),
  };
}

function normalizeArtifactKind(value: string): string {
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

function mapEvent(row: DbRow): ExecutionEvent {
  return {
    eventId: stringValue(row['eventId']),
    sequence: numberValue(row['sequence']),
    type: stringValue(row['type']),
    occurredAt: dateIso(row['occurredAt']),
    payload:
      row['payload'] && typeof row['payload'] === 'object'
        ? (row['payload'] as Record<string, unknown>)
        : {},
    runId: stringValue(row['runId']),
    jobId: stringValue(row['jobId']),
    leaseId: stringValue(row['leaseId']),
    fencingToken: numberValue(row['fencingToken']),
    receivedAt: dateIso(row['receivedAt']),
    hash: stringValue(row['hash']),
  };
}

function mapArtifact(row: DbRow): ArtifactDescriptor {
  return {
    id: stringValue(row['id']),
    runId: stringValue(row['runId']),
    jobId: nullableString(row['jobId']),
    testId: nullableString(row['testId']),
    kind: normalizeArtifactKind(stringValue(row['kind'], 'other')),
    name: stringValue(row['name']),
    contentType: stringValue(row['contentType'], 'application/octet-stream'),
    sizeBytes: numberValue(row['sizeBytes']),
    checksum: stringValue(row['checksum'], '0'.repeat(64)),
    storageKey: stringValue(row['storageKey']),
    createdAt: dateIso(row['createdAt']),
    expiresAt: nullableDateIso(row['expiresAt']),
    legalHold: row['legalHold'] === true,
    metadata:
      row['metadata'] && typeof row['metadata'] === 'object'
        ? (row['metadata'] as Record<string, unknown>)
        : {},
  };
}

function rowValue(row: unknown): DbRow {
  return row && typeof row === 'object' ? (row as DbRow) : {};
}

export class DrizzleExecutionStore implements ExecutionStore {
  private readonly db: AnyPgDb;
  private readonly options: DrizzleExecutionStoreOptions;
  /** Bounded: the in-process artifact fallback, by total bytes, not by entry count. */
  private readonly memoryBytes = new BoundedByteMap<string>(ARTIFACT_BYTE_CAPACITY);
  /** Bounded: a job completion hash is only consulted while a client retries that job. */
  private readonly completionHashes = new BoundedMap<string, string>(
    'completionHashes',
    COMPLETION_HASH_CAPACITY,
  );

  constructor(options: DrizzleExecutionStoreOptions) {
    this.db = options.db;
    this.options = options;
  }

  private async appendOutbox(tx: unknown, event: OutboxAppend): Promise<void> {
    await this.appendOutboxBatch(tx, [event]);
  }

  private async appendOutboxBatch(tx: unknown, events: OutboxAppend[]): Promise<void> {
    if (events.length === 0) return;
    const repository = new DrizzleOutboxRepository(tx as OutboxDatabase);
    await repository.appendMany(
      events.map((event) => ({
        workspaceId: event.workspaceId,
        aggregateType: 'run',
        aggregateId: event.aggregateId,
        eventType: event.eventType,
        eventVersion: 1,
        payload: sanitizeOutboxEnvelope(event.payload),
        dedupeKey: event.dedupeKey,
        occurredAt: event.occurredAt,
        expiresAt: new Date(
          event.occurredAt.getTime() +
            (this.options.outboxRetentionHours ?? OUTBOX_DEFAULT_RETENTION_HOURS) * 3_600_000,
        ),
      })),
    );
  }

  async createRun(
    input: CreateRunInput,
    idempotencyKey: string,
    workspaceId = 'default-workspace',
  ): Promise<CreateRunResult> {
    const existing = await this.findByIdempotency(workspaceId, idempotencyKey);
    if (existing) {
      const existingId = stringValue(existing.id);
      const job = (
        await this.db
          .select()
          .from(executionJobs)
          .where(
            and(
              eq(executionJobs.runId, existingId),
              eq(executionJobs.attempt, numberValue(existing.attempt, 1)),
            ),
          )
          .limit(1)
      )[0];
      if (job)
        return {
          run: (await this.getRun(existingId, workspaceId)) as ExecutionRun,
          job: mapJob(rowValue(job)),
          duplicate: true,
        };
    }
    const timestamp = nowDate(this.options);
    const id = randomUUID();
    const projectId = input.projectId ? uuidFor(input.projectId) : null;
    const environmentId = input.environmentId ? uuidFor(input.environmentId) : null;
    const releaseId = input.releaseId ? uuidFor(input.releaseId) : null;
    const policyId = input.policyId ? uuidFor(input.policyId) : null;
    const attempt = input.retryOfRunId
      ? ((await this.getRun(input.retryOfRunId, workspaceId))?.attempt ?? 0) + 1
      : 1;
    const jobId = randomUUID();
    const runValues = {
      id,
      externalId: input.externalId ?? null,
      startedAt: timestamp,
      finishedAt: null,
      completedAt: null,
      status: 'running' as const,
      phase: 'queued' as const,
      outcome: null,
      attempt,
      priority: input.priority ?? 0,
      total: 0,
      passed: 0,
      failed: 0,
      flaky: 0,
      skipped: 0,
      blocked: 0,
      unknown: 0,
      durationMs: null,
      branch: input.branch ?? null,
      commitSha: input.commit ?? null,
      source: input.source ?? 'api',
      framework: input.framework ?? 'playwright',
      adapterVersion: input.adapterVersion ?? '1',
      testType: input.testType ?? 'browser',
      projectId,
      environmentId,
      releaseId,
      suite: input.suite ?? null,
      selection: input.selection ?? [],
      requiredCapabilities: input.requiredCapabilities ?? ['playwright'],
      labels: input.labels ?? [],
      timeoutMs: input.timeoutMs ?? 1_800_000,
      policyId,
      idempotencyKey: idempotencyKey.trim(),
      retryOfRunId: input.retryOfRunId ?? null,
      eventSequence: 0,
      rawEvidenceRefs: [],
      workspaceId,
      config: input.configuration ?? {},
      metadata: input.metadata ?? {},
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const jobValues = {
      id: jobId,
      workspaceId,
      runId: id,
      attempt,
      priority: input.priority ?? 0,
      state: 'queued' as const,
      availableAt: input.availableAt ? new Date(input.availableAt) : timestamp,
      requiredCapabilities: input.requiredCapabilities ?? ['playwright'],
      labels: input.labels ?? [],
      timeoutMs: input.timeoutMs ?? 1_800_000,
      spec: {
        projectId,
        environmentId,
        releaseId,
        suite: input.suite ?? null,
        selection: input.selection ?? [],
        configuration: input.configuration ?? {},
      },
      fencingToken: 0,
      idempotencyKey: `${idempotencyKey}:attempt:${attempt}`,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    try {
      await this.db.transaction(async (tx) => {
        await tx.insert(runs).values(runValues);
        await tx.insert(executionJobs).values(jobValues);
        await this.appendOutbox(tx, {
          workspaceId,
          aggregateId: id,
          eventType: 'execution.run.created',
          dedupeKey: `execution:${workspaceId}:run.created:${id}`,
          occurredAt: timestamp,
          payload: {
            runId: id,
            jobId,
            attempt,
            phase: 'queued',
            outcome: null,
            status: 'running',
            source: runValues.source,
            idempotencyKey: runValues.idempotencyKey,
          },
        });
      });
    } catch (error) {
      const raced = await this.findByIdempotency(workspaceId, idempotencyKey);
      if (raced) {
        const racedId = stringValue(raced.id);
        const job = (
          await this.db
            .select()
            .from(executionJobs)
            .where(eq(executionJobs.runId, racedId))
            .limit(1)
        )[0];
        if (job)
          return {
            run: (await this.getRun(racedId, workspaceId)) as ExecutionRun,
            job: mapJob(rowValue(job)),
            duplicate: true,
          };
      }
      throw error;
    }
    return {
      run: (await this.getRun(id, workspaceId)) as ExecutionRun,
      job: mapJob(
        rowValue(
          (
            await this.db.select().from(executionJobs).where(eq(executionJobs.id, jobId)).limit(1)
          )[0],
        ),
      ),
      duplicate: false,
    };
  }

  async listRuns(workspaceId?: string, releaseId?: string): Promise<ExecutionRun[]> {
    const filters = [
      workspaceId === undefined ? undefined : eq(runs.workspaceId, workspaceId),
      releaseId === undefined ? undefined : eq(runs.releaseId, releaseId),
    ].filter((value): value is ReturnType<typeof eq> => value !== undefined);
    const rows = await this.db
      .select()
      .from(runs)
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(asc(runs.createdAt));
    return this.mapRuns(rows.map((row) => rowValue(row)));
  }

  async getRun(runId: string, workspaceId?: string): Promise<ExecutionRun | null> {
    const filters = [
      eq(runs.id, runId),
      workspaceId === undefined ? undefined : eq(runs.workspaceId, workspaceId),
    ].filter((value): value is ReturnType<typeof eq> => value !== undefined);
    const row = (
      await this.db
        .select()
        .from(runs)
        .where(and(...filters))
        .limit(1)
    )[0];
    return row ? this.mapRun(rowValue(row)) : null;
  }

  async cancelRun(runId: string, workspaceId?: string): Promise<ExecutionRun | null> {
    const run = await this.getRun(runId, workspaceId);
    if (!run) return null;
    if (
      [
        'complete',
        'cancelled',
        'timed_out',
        'runner_lost',
        'infra_failed',
        'config_failed',
        'blocked',
        'partial',
      ].includes(run.phase)
    )
      return run;
    const timestamp = iso(nowDate(this.options));
    await this.db.transaction(async (tx) => {
      await tx
        .update(runs)
        .set({
          phase: 'cancelled',
          outcome: 'cancelled',
          status: 'running',
          completedAt: new Date(timestamp),
          updatedAt: new Date(timestamp),
          cancelRequestedAt: new Date(timestamp),
        })
        .where(eq(runs.id, runId));
      await tx
        .update(executionJobs)
        .set({
          state: 'cancelled',
          updatedAt: new Date(timestamp),
          leaseId: null,
          leaseOwner: null,
          leaseExpiresAt: null,
        })
        .where(
          and(
            eq(executionJobs.runId, runId),
            inArray(executionJobs.state, ['queued', 'leased', 'requeued']),
          ),
        );
      await this.appendOutbox(tx, {
        workspaceId: run.workspaceId,
        aggregateId: runId,
        eventType: 'execution.run.cancelled',
        dedupeKey: `execution:${run.workspaceId}:run.cancelled:${runId}`,
        occurredAt: new Date(timestamp),
        payload: {
          runId,
          attempt: run.attempt,
          phase: 'cancelled',
          outcome: 'cancelled',
        },
      });
    });
    return this.getRun(runId, workspaceId);
  }

  async retryRun(
    runId: string,
    workspaceId?: string,
    idempotencyKey?: string,
  ): Promise<CreateRunResult | null> {
    const previous = await this.getRun(runId, workspaceId);
    if (
      !previous ||
      ![
        'complete',
        'cancelled',
        'timed_out',
        'runner_lost',
        'infra_failed',
        'config_failed',
        'blocked',
        'partial',
      ].includes(previous.phase)
    )
      return null;
    return this.createRun(
      {
        externalId: previous.externalId,
        source: previous.source,
        framework: previous.framework,
        adapterVersion: previous.adapterVersion,
        testType: previous.testType,
        projectId: previous.projectId ?? undefined,
        environmentId: previous.environmentId ?? undefined,
        releaseId: previous.releaseId ?? undefined,
        branch: previous.branch ?? undefined,
        commit: previous.commit ?? undefined,
        suite: previous.suite ?? undefined,
        selection: previous.selection,
        timeoutMs: previous.timeoutMs,
        priority: previous.priority,
        requiredCapabilities: previous.requiredCapabilities,
        labels: previous.labels,
        configuration: previous.configuration,
        metadata: previous.metadata,
        policyId: previous.policyId ?? undefined,
        retryOfRunId: previous.id,
      },
      idempotencyKey ?? `retry:${previous.id}:${previous.attempt + 1}`,
      previous.workspaceId,
    );
  }

  async getJob(jobId: string, workspaceId?: string): Promise<ExecutionJob | null> {
    const row = (
      await this.db
        .select()
        .from(executionJobs)
        .where(jobScope(eq(executionJobs.id, jobId), workspaceId))
        .limit(1)
    )[0];
    return row ? mapJob(rowValue(row)) : null;
  }

  async listJobs(workspaceId?: string): Promise<ExecutionJob[]> {
    const rows = await this.db
      .select()
      .from(executionJobs)
      .where(workspaceId === undefined ? undefined : eq(executionJobs.workspaceId, workspaceId))
      .orderBy(asc(executionJobs.createdAt));
    return rows.map((row) => mapJob(rowValue(row)));
  }

  async registerRunner(
    manifest: RunnerManifest,
    tokenHash: string,
    tokenExpiresAt: string,
    workspaceId = this.options.workspaceId ?? 'default-workspace',
  ): Promise<RegisteredRunner> {
    const timestamp = nowDate(this.options);
    const runnerId = uuidFor(manifest.id);
    const row = {
      id: runnerId,
      workspaceId,
      name: manifest.name,
      version: manifest.version,
      os: manifest.os,
      arch: manifest.arch,
      capabilities: manifest.capabilities,
      labels: manifest.labels,
      slots: manifest.slots,
      health: 'healthy' as const,
      tokenHash,
      tokenExpiresAt: new Date(tokenExpiresAt),
      lastHeartbeatAt: timestamp,
      metrics: {},
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await this.db
      .insert(runners)
      .values(row)
      .onConflictDoUpdate({
        target: runners.id,
        set: {
          name: manifest.name,
          version: manifest.version,
          os: manifest.os,
          arch: manifest.arch,
          capabilities: manifest.capabilities,
          labels: manifest.labels,
          slots: manifest.slots,
          health: 'healthy',
          tokenHash,
          tokenExpiresAt: new Date(tokenExpiresAt),
          lastHeartbeatAt: timestamp,
          updatedAt: timestamp,
        },
      });
    return mapRunner(row);
  }

  async getRunner(runnerId: string): Promise<RegisteredRunner | null> {
    const row = (await this.db.select().from(runners).where(eq(runners.id, runnerId)).limit(1))[0];
    return row ? mapRunner(rowValue(row)) : null;
  }

  async authenticateRunner(token: string): Promise<RegisteredRunner | null> {
    const rows = await this.db.select().from(runners);
    for (const row of rows) {
      const data = rowValue(row);
      if (
        tokenMatches(token, stringValue(data['tokenHash'])) &&
        data['health'] !== 'revoked' &&
        new Date(dateIso(data['tokenExpiresAt'])).getTime() > nowDate(this.options).getTime()
      )
        return mapRunner(data);
    }
    return null;
  }

  async heartbeatRunner(
    runnerId: string,
    activeJobIds: string[] = [],
    health: RunnerHealth = 'healthy',
  ): Promise<RunnerHeartbeat | null> {
    const timestamp = nowDate(this.options);
    const updated = await this.db
      .update(runners)
      .set({ lastHeartbeatAt: timestamp, health, updatedAt: timestamp })
      .where(eq(runners.id, runnerId))
      .returning();
    if (updated.length === 0) return null;
    await this.db
      .update(executionJobs)
      .set({
        heartbeatAt: timestamp,
        leaseExpiresAt: new Date(
          timestamp.getTime() + (this.options.leaseDurationMs ?? this.options.leaseMs ?? 30_000),
        ),
        updatedAt: timestamp,
      })
      .where(and(eq(executionJobs.leaseOwner, runnerId), eq(executionJobs.state, 'leased')));
    return {
      runnerId,
      health,
      lastHeartbeatAt: timestamp.toISOString(),
      activeJobIds: [...new Set(activeJobIds)],
    };
  }

  async claimJob(
    runnerId: string,
    capabilities: string[] = [],
    labels: string[] = [],
    now = nowDate(this.options),
    workspaceId?: string,
  ): Promise<JobClaim | null> {
    await this.reapExpiredLeases(now);
    const runner = await this.getRunner(runnerId);
    if (!runner || runner.health === 'revoked' || runner.health === 'offline') return null;
    const active = await this.db
      .select()
      .from(executionJobs)
      .where(
        jobScope(
          and(eq(executionJobs.leaseOwner, runnerId), eq(executionJobs.state, 'leased')),
          workspaceId,
        ),
      );
    if (active.length >= Math.max(1, runner.slots)) return null;
    const effective = new Set([...runner.capabilities, ...capabilities]);
    const effectiveLabels = new Set([...runner.labels, ...labels]);
    const claim = await this.db.transaction(async (tx) => {
      const candidates = await tx
        .select()
        .from(executionJobs)
        .where(jobScope(inArray(executionJobs.state, ['queued', 'requeued']), workspaceId))
        .orderBy(desc(executionJobs.priority), asc(executionJobs.createdAt))
        .limit(50)
        .for('update', { skipLocked: true });
      const job = candidates
        .map((row) => mapJob(rowValue(row)))
        .find(
          (item) =>
            new Date(item.availableAt).getTime() <= now.getTime() &&
            item.requiredCapabilities.every((itemCapability) => effective.has(itemCapability)) &&
            item.labels.every((label) => effectiveLabels.has(label)),
        );
      if (!job) return null;
      const leaseId = randomUUID();
      const leaseExpiresAt = new Date(
        now.getTime() + (this.options.leaseDurationMs ?? this.options.leaseMs ?? 30_000),
      );
      const updatedRows = await tx
        .update(executionJobs)
        .set({
          state: 'leased',
          leaseId,
          leaseOwner: runnerId,
          leaseExpiresAt,
          heartbeatAt: now,
          fencingToken: job.fencingToken + 1,
          updatedAt: now,
        })
        .where(
          jobScope(
            and(eq(executionJobs.id, job.id), inArray(executionJobs.state, ['queued', 'requeued'])),
            workspaceId,
          ),
        )
        .returning();
      if (updatedRows.length === 0) return null;
      await tx
        .update(runs)
        .set({
          phase: 'assigned',
          status: 'running',
          startedAt: now,
          updatedAt: now,
          runnerId,
          currentJobId: job.id,
        })
        .where(eq(runs.id, job.runId));
      const run = (await tx.select().from(runs).where(eq(runs.id, job.runId)).limit(1))[0];
      return {
        job: mapJob(rowValue(updatedRows[0])),
        run: run ? rowValue(run) : null,
        leaseId,
        leaseExpiresAt,
      };
    });
    if (!claim?.run) return null;
    return {
      jobId: claim.job.id,
      runId: claim.job.runId,
      attempt: claim.job.attempt,
      leaseId: claim.leaseId,
      fencingToken: claim.job.fencingToken,
      timeoutMs: numberValue(claim.run['timeoutMs'], 1_800_000),
      spec:
        claim.job.requiredCapabilities.length >= 0
          ? {
              projectId: nullableString(claim.run['projectId']),
              environmentId: nullableString(claim.run['environmentId']),
              suite: nullableString(claim.run['suite']),
              selection: Array.isArray(claim.run['selection']) ? claim.run['selection'] : [],
              configuration:
                claim.run['config'] && typeof claim.run['config'] === 'object'
                  ? (claim.run['config'] as Record<string, unknown>)
                  : {},
            }
          : {},
      availableAt: claim.job.availableAt,
      leaseExpiresAt: claim.leaseExpiresAt.toISOString(),
    };
  }

  async appendEvents(
    jobId: string,
    leaseId: string,
    fencingToken: number,
    inputs: ExecutionEventInput[],
    workspaceId?: string,
  ): Promise<EventApplyResult[]> {
    return this.db.transaction(async (tx) => {
      const jobRow = (
        await tx
          .select()
          .from(executionJobs)
          .where(jobScope(eq(executionJobs.id, jobId), workspaceId))
          .limit(1)
      )[0];
      const job = jobRow ? mapJob(rowValue(jobRow)) : null;
      if (
        !job ||
        job.state !== 'leased' ||
        job.leaseId !== leaseId ||
        job.fencingToken !== fencingToken
      )
        return inputs.map((event) => ({
          eventId: event.eventId,
          sequence: event.sequence,
          status: 'conflict' as const,
          reason: 'stale_lease',
        }));
      const runRow = (await tx.select().from(runs).where(eq(runs.id, job.runId)).limit(1))[0];
      if (!runRow)
        return inputs.map((event) => ({
          eventId: event.eventId,
          sequence: event.sequence,
          status: 'conflict' as const,
          reason: 'run_not_found',
        }));
      const existing = (
        await tx.select().from(runEvents).where(eq(runEvents.runId, job.runId))
      ).map((row) => rowValue(row));
      const byId = new Map(existing.map((event) => [stringValue(event['eventKey']), event]));
      let sequence = numberValue(runRow['eventSequence']) + 1;
      let terminal = existing.some((event) => event['type'] === 'run.completed');
      const prepared: Array<{
        input: ExecutionEventInput;
        hash: string;
        eventKey: string;
        duplicate: boolean;
      }> = [];
      for (const input of inputs) {
        const hash = eventDigest(input);
        const eventKey = `${job.runId}:${input.eventId}`;
        const previous = byId.get(eventKey);
        if (previous) {
          if (stringValue(previous['hash']) !== hash)
            return [
              {
                eventId: input.eventId,
                sequence: input.sequence,
                status: 'conflict',
                reason: 'event_hash_mismatch',
                hash,
              },
            ];
          prepared.push({ input, hash, eventKey, duplicate: true });
          continue;
        }
        if (input.sequence !== sequence)
          return [
            {
              eventId: input.eventId,
              sequence: input.sequence,
              status: 'conflict',
              reason: terminal ? 'terminal_event' : 'sequence_gap',
              hash,
            },
          ];
        if (terminal)
          return [
            {
              eventId: input.eventId,
              sequence: input.sequence,
              status: 'conflict',
              reason: 'terminal_event',
              hash,
            },
          ];
        prepared.push({ input, hash, eventKey, duplicate: false });
        byId.set(eventKey, { hash });
        sequence += 1;
        if (input.type === 'run.completed' || input.payload?.['terminal'] === true) terminal = true;
      }
      const results: EventApplyResult[] = [];
      const eventWorkspaceId = stringValue(runRow['workspaceId'], 'default-workspace');
      const outboxBatch: OutboxAppend[] = [];
      for (const item of prepared) {
        if (item.duplicate) {
          results.push({
            eventId: item.input.eventId,
            sequence: item.input.sequence,
            status: 'duplicate',
            hash: item.hash,
          });
          continue;
        }
        const input = item.input;
        const eventId = input.eventId;
        const occurredAt = input.occurredAt ? new Date(input.occurredAt) : nowDate(this.options);
        await tx.insert(runEvents).values({
          eventId,
          runId: job.runId,
          workspaceId: eventWorkspaceId,
          jobId,
          sequence: input.sequence,
          source: 'runner',
          eventKey: item.eventKey,
          hash: item.hash,
          type: input.type,
          payload: input.payload ?? {},
          leaseId,
          fencingToken,
          occurredAt,
          receivedAt: nowDate(this.options),
        });
        results.push({
          eventId: input.eventId,
          sequence: input.sequence,
          status: 'accepted',
          hash: item.hash,
        });
        outboxBatch.push({
          workspaceId: eventWorkspaceId,
          aggregateId: job.runId,
          eventType: 'execution.event.appended',
          dedupeKey: `execution:${eventWorkspaceId}:event.appended:${item.eventKey}`,
          occurredAt,
          payload: {
            runId: job.runId,
            jobId,
            eventId,
            sequence: input.sequence,
            type: input.type,
            occurredAt: occurredAt.toISOString(),
            leaseId,
            fencingToken,
            payload: input.payload ?? {},
          },
        });
        await tx
          .update(runs)
          .set({ eventSequence: input.sequence, updatedAt: nowDate(this.options) })
          .where(eq(runs.id, job.runId));
        const payload = input.payload ?? {};
        const requestedPhase = input.type === 'run.completed' ? 'complete' : payload['phase'];
        if (isRequestablePhase(requestedPhase)) {
          // `phase` and `outcome` are derived together from the phase, never
          // taken independently from the payload. Writing them separately made
          // the CHECK unreachable by a client choice, rolled the transaction
          // back, and surfaced as a 500 for a merely malformed request.
          const derived = deriveRunState(requestedPhase, payload['outcome']);
          await tx
            .update(runs)
            .set({
              phase: derived.phase,
              outcome: derived.outcome,
              status: derived.status,
              completedAt: derived.terminal ? nowDate(this.options) : null,
              finishedAt: derived.terminal ? nowDate(this.options) : null,
              updatedAt: nowDate(this.options),
            })
            .where(eq(runs.id, job.runId));
        }
        if (input.type === 'test.started' || input.type === 'test.completed') {
          const testId = stringValue(payload['testId'], eventId);
          const testStatus =
            input.type === 'test.started'
              ? 'running'
              : dbTestStatus(
                  String(payload['status'] ?? 'unknown') as ExecutionTestResult['status'],
                );
          const testDuration = numberValue(payload['durationMs'], 0) || null;
          await tx
            .insert(tests)
            .values({
              id: testId,
              runId: job.runId,
              title: stringValue(payload['title'], testId),
              file: stringValue(payload['file'], ''),
              status: testStatus,
              durationMs: testDuration,
              retryCount: 0,
            })
            .onConflictDoUpdate({
              target: [tests.id, tests.runId],
              set: {
                title: stringValue(payload['title'], testId),
                status: testStatus,
                durationMs: testDuration,
              },
            });
        }
      }
      await this.appendOutboxBatch(tx, outboxBatch);
      return results;
    });
  }

  async listEvents(runId: string): Promise<ExecutionEvent[]> {
    const rows = await this.db
      .select()
      .from(runEvents)
      .where(eq(runEvents.runId, runId))
      .orderBy(asc(runEvents.sequence));
    return rows.map((row) => mapEvent(rowValue(row)));
  }

  async getRunEvents(runId: string): Promise<ExecutionEvent[]> {
    return this.listEvents(runId);
  }

  async completeJob(
    jobId: string,
    completion: JobCompletionInput,
    workspaceId?: string,
  ): Promise<JobCompletionResult | null> {
    const completionHash = digest(completion);
    const previousHash = this.completionHashes.get(jobId);
    const result = await this.db.transaction(async (tx) => {
      const jobRow = (
        await tx
          .select()
          .from(executionJobs)
          .where(jobScope(eq(executionJobs.id, jobId), workspaceId))
          .limit(1)
      )[0];
      if (!jobRow) return null;
      const jobRecord = rowValue(jobRow);
      const job = mapJob(jobRecord);
      const storedHash = nullableString(jobRecord['completionHash']);
      const effectivePreviousHash = storedHash ?? previousHash;
      if (effectivePreviousHash && effectivePreviousHash !== completionHash) return null;
      if (job.leaseId !== completion.leaseId || job.fencingToken !== completion.fencingToken)
        return null;
      if (effectivePreviousHash) return { runId: job.runId, duplicate: true };
      const timestamp = nowDate(this.options);
      const status = (completion.status ?? completion.outcome ?? 'unknown').toLowerCase();
      const rawPhase = completion.phase;
      const phase: RunPhase =
        rawPhase === 'completed'
          ? 'complete'
          : (rawPhase ??
            (status === 'cancelled'
              ? 'cancelled'
              : status === 'timed_out'
                ? 'timed_out'
                : status === 'runner_lost'
                  ? 'runner_lost'
                  : status === 'infra_failed'
                    ? 'infra_failed'
                    : status === 'config_failed'
                      ? 'config_failed'
                      : 'complete'));
      const outcome =
        completion.outcome ??
        (status === 'passed' || status === 'succeeded'
          ? 'passed'
          : status === 'failed'
            ? 'failed'
            : status === 'cancelled'
              ? 'cancelled'
              : status === 'timed_out'
                ? 'timed_out'
                : status === 'runner_lost'
                  ? 'runner_lost'
                  : status === 'infra_failed'
                    ? 'infra_failed'
                    : status === 'config_failed'
                      ? 'config_failed'
                      : 'unknown');
      // Derived after the tests and summary are written, so a run that reports
      // nothing cannot land as a green run. The phase and the outcome are decided
      // together — writing them independently is what made
      // `runs_phase_outcome_check` reachable by a client choice.
      const derived = deriveRunState(phase, outcome);
      if (completion.tests) {
        for (const test of completion.tests) {
          await tx
            .insert(tests)
            .values({
              id: test.id,
              runId: job.runId,
              title: test.title,
              file: test.file ?? '',
              status: dbTestStatus(test.status),
              durationMs: test.durationMs ?? null,
              retryCount: Math.max(0, (test.attempt ?? 1) - 1),
            })
            .onConflictDoUpdate({
              target: [tests.id, tests.runId],
              set: {
                title: test.title,
                status: dbTestStatus(test.status),
                durationMs: test.durationMs ?? null,
              },
            });
        }
      }
      await tx
        .update(executionJobs)
        .set({
          state:
            status === 'cancelled' ? 'cancelled' : status === 'failed' ? 'failed' : 'completed',
          completionHash,
          completedAt: timestamp,
          updatedAt: timestamp,
          leaseExpiresAt: null,
          errorCode: completion.error?.code ?? null,
          errorMessage: completion.error?.message ?? null,
        })
        .where(eq(executionJobs.id, jobId));
      const summaryTotal = completion.summary?.total ?? completion.tests?.length ?? 0;
      const summaryPassed = completion.summary?.passed ?? 0;
      const summaryFailed = completion.summary?.failed ?? 0;
      const summaryFlaky = completion.summary?.flaky ?? 0;
      // A run with no tests, a zero total and no recorded pass has produced no
      // evidence, so `passed` is not available to it. `interrupted` is the
      // existing "finished without a determinate outcome" value — using it keeps
      // the status vocabulary at four members and needs no migration.
      const runStatus =
        derived.outcome === 'passed' &&
        summaryTotal === 0 &&
        summaryPassed === 0 &&
        summaryFailed === 0 &&
        summaryFlaky === 0
          ? 'interrupted'
          : derived.status;
      await tx
        .update(runs)
        .set({
          phase: derived.phase,
          outcome: derived.outcome,
          status: runStatus,
          completedAt: timestamp,
          finishedAt: timestamp,
          updatedAt: timestamp,
          errorCode: completion.error?.code ?? null,
          errorMessage: completion.error?.message ?? null,
          total: completion.summary?.total ?? job.attempt,
          passed: completion.summary?.passed ?? 0,
          failed: completion.summary?.failed ?? 0,
          flaky: completion.summary?.flaky ?? 0,
          skipped: completion.summary?.skipped ?? 0,
          blocked: completion.summary?.blocked ?? 0,
          unknown: completion.summary?.unknown ?? 0,
          durationMs: completion.summary?.durationMs ?? null,
        })
        .where(eq(runs.id, job.runId));
      const jobWorkspaceId = stringValue(jobRecord['workspaceId'], 'default-workspace');
      await this.appendOutbox(tx, {
        workspaceId: jobWorkspaceId,
        aggregateId: job.runId,
        eventType: 'execution.job.completed',
        dedupeKey: `execution:${jobWorkspaceId}:job.completed:${jobId}`,
        occurredAt: timestamp,
        payload: {
          runId: job.runId,
          jobId,
          phase,
          outcome,
          status:
            status === 'cancelled' ? 'cancelled' : status === 'failed' ? 'failed' : 'completed',
          summary: completion.summary ?? null,
          error: completion.error ?? null,
        },
      });
      return { runId: job.runId, duplicate: false };
    });
    if (!result) return null;
    this.completionHashes.set(jobId, completionHash);
    const run = await this.getRun(result.runId);
    const job = await this.getJob(jobId);
    if (!run || !job) return null;
    if (!result.duplicate) {
      const policies = await this.listPolicies(run.workspaceId);
      const policy = policies[0] ?? (await this.createPolicy(defaultPolicy(run.workspaceId)));
      await this.saveGate(
        createGateEvaluation({
          run,
          policy,
          domainStatuses: {
            browser:
              run.outcome === 'passed'
                ? 'passed'
                : run.outcome === 'failed'
                  ? 'failed'
                  : run.outcome === 'partial'
                    ? 'warning'
                    : 'unknown',
          },
        }),
      );
    }
    return { run, job, status: result.duplicate ? 'duplicate' : 'accepted' };
  }

  async addArtifact(
    input: Omit<StoredArtifact, 'id' | 'checksum' | 'sizeBytes' | 'createdAt'> & {
      bytes: Uint8Array;
    },
  ): Promise<ArtifactDescriptor> {
    const bytes = new Uint8Array(input.bytes);
    const checksum = digest(bytes);
    if (this.options.artifactBytes) await this.options.artifactBytes.put(input.storageKey, bytes);
    else this.memoryBytes.set(input.storageKey, bytes);
    const row = {
      id: randomUUID(),
      runId: input.runId,
      jobId: input.jobId,
      testId: input.testId,
      kind: input.kind,
      name: input.name,
      contentType: input.contentType,
      storageKey: input.storageKey,
      checksum,
      sizeBytes: bytes.byteLength,
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      legalHold: input.legalHold,
      metadata: input.metadata,
      createdAt: nowDate(this.options),
    };
    const allowed = [
      'report',
      'junit',
      'json',
      'log',
      'stdout',
      'stderr',
      'screenshot',
      'video',
      'trace',
      'html',
      'attachment',
      'other',
    ] as const;
    const normalizedKind = allowed.includes(row.kind as (typeof allowed)[number])
      ? (row.kind as (typeof allowed)[number])
      : ('other' as const);
    const dbRow = { ...row, kind: normalizedKind };
    await this.db.insert(artifacts).values({ ...dbRow, kind: normalizedKind });
    return mapArtifact(dbRow);
  }

  async getArtifact(artifactId: string, workspaceId?: string): Promise<StoredArtifact | null> {
    const descriptor = await this.getArtifactDescriptor(artifactId, workspaceId);
    if (!descriptor) return null;
    const bytes = this.options.artifactBytes
      ? await this.options.artifactBytes.get(descriptor.storageKey)
      : this.memoryBytes.get(descriptor.storageKey);
    return bytes ? { ...descriptor, bytes: new Uint8Array(bytes) } : null;
  }

  async getArtifactDescriptor(
    artifactId: string,
    workspaceId?: string,
  ): Promise<ArtifactDescriptor | null> {
    // `artifacts` has no workspace column of its own, so the scope is the
    // artifact's run. A run with a NULL workspace_id never matches.
    let scope: SQL | undefined = eq(artifacts.id, artifactId);
    if (workspaceId !== undefined) {
      const scopedRuns = this.db
        .select({ id: runs.id })
        .from(runs)
        .where(eq(runs.workspaceId, workspaceId));
      scope = and(scope, inArray(artifacts.runId, scopedRuns));
    }
    const row = (await this.db.select().from(artifacts).where(scope).limit(1))[0];
    return row ? mapArtifact(rowValue(row)) : null;
  }

  async listArtifacts(runId: string): Promise<ArtifactDescriptor[]> {
    const rows = await this.db
      .select()
      .from(artifacts)
      .where(eq(artifacts.runId, runId))
      .orderBy(asc(artifacts.createdAt));
    return rows.map((row) => mapArtifact(rowValue(row)));
  }

  async createPolicy(
    input: Omit<QualityPolicy, 'id' | 'hash' | 'createdAt' | 'updatedAt'>,
  ): Promise<QualityPolicy> {
    const timestamp = nowDate(this.options);
    const row = {
      id: randomUUID(),
      workspaceId: input.workspaceId,
      name: input.name,
      version: input.version,
      hash: digest(input),
      requiredDomains: input.requiredDomains,
      browserPassRateThreshold: input.browserPassRateThreshold,
      maxFlakyRate: input.maxFlakyRate,
      maxDurationMs: input.maxDurationMs,
      rules: input.rules,
      isDefault: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await this.db.insert(qualityPolicies).values(row);
    return mapPolicy(row);
  }

  async listPolicies(workspaceId?: string): Promise<QualityPolicy[]> {
    const rows = await this.db
      .select()
      .from(qualityPolicies)
      .where(workspaceId === undefined ? undefined : eq(qualityPolicies.workspaceId, workspaceId))
      .orderBy(asc(qualityPolicies.createdAt));
    return rows.map((row) => mapPolicy(rowValue(row)));
  }

  async getPolicy(policyId: string, workspaceId?: string): Promise<QualityPolicy | null> {
    const row = (
      await this.db
        .select()
        .from(qualityPolicies)
        .where(
          and(
            eq(qualityPolicies.id, policyId),
            workspaceId === undefined ? undefined : eq(qualityPolicies.workspaceId, workspaceId),
          ),
        )
        .limit(1)
    )[0];
    return row ? mapPolicy(rowValue(row)) : null;
  }

  async saveGate(evaluation: GateEvaluation): Promise<GateEvaluation> {
    const row = {
      id: uuidFor(evaluation.id),
      workspaceId: (await this.getRun(evaluation.runId))?.workspaceId ?? 'default-workspace',
      runId: evaluation.runId,
      releaseId: evaluation.releaseId ? uuidFor(evaluation.releaseId) : null,
      policyId: uuidFor(evaluation.policyId),
      policyVersion: evaluation.policyVersion,
      policyHash: evaluation.policyHash,
      status: evaluation.status,
      decision: evaluation.decision,
      reasons: evaluation.reasons,
      evidenceRefs: evaluation.evidenceRefs,
      domainStatuses: evaluation.domainStatuses,
      evaluatedAt: new Date(evaluation.evaluatedAt),
      createdAt: nowDate(this.options),
    };
    await this.db
      .insert(gateEvaluations)
      .values(row)
      .onConflictDoUpdate({
        target: [gateEvaluations.runId, gateEvaluations.policyId, gateEvaluations.policyHash],
        set: {
          status: evaluation.status,
          decision: evaluation.decision,
          reasons: evaluation.reasons,
          evidenceRefs: evaluation.evidenceRefs,
          domainStatuses: evaluation.domainStatuses,
          evaluatedAt: new Date(evaluation.evaluatedAt),
        },
      });
    return mapGate(row);
  }

  async getGate(runId: string): Promise<GateEvaluation | null> {
    const row = (
      await this.db
        .select()
        .from(gateEvaluations)
        .where(eq(gateEvaluations.runId, runId))
        .orderBy(desc(gateEvaluations.evaluatedAt))
        .limit(1)
    )[0];
    return row ? mapGate(rowValue(row)) : null;
  }

  async getRunGate(workspaceId: string, runId: string): Promise<GateEvaluation | null> {
    const row = (
      await this.db
        .select()
        .from(gateEvaluations)
        .where(and(eq(gateEvaluations.runId, runId), eq(gateEvaluations.workspaceId, workspaceId)))
        .orderBy(desc(gateEvaluations.evaluatedAt))
        .limit(1)
    )[0];
    return row ? mapGate(rowValue(row)) : null;
  }

  async reapExpiredLeases(now = nowDate(this.options)): Promise<LeaseReapResult[]> {
    const expired = await this.db
      .select()
      .from(executionJobs)
      .where(
        and(eq(executionJobs.state, 'leased'), sql`${executionJobs.leaseExpiresAt} <= ${now}`),
      );
    const results: LeaseReapResult[] = [];
    for (const row of expired) {
      const job = mapJob(rowValue(row));
      const canRequeue = job.attempt < 3;
      await this.db.transaction(async (tx) => {
        await tx
          .update(executionJobs)
          .set({
            attempt: canRequeue ? job.attempt + 1 : job.attempt,
            state: canRequeue ? 'queued' : 'failed',
            availableAt: canRequeue ? now : new Date(job.availableAt),
            leaseId: null,
            leaseOwner: null,
            leaseExpiresAt: null,
            errorCode: 'RUNNER_LOST',
            errorMessage: 'Runner lease expired',
            updatedAt: now,
          })
          .where(eq(executionJobs.id, job.id));
        await tx
          .update(runs)
          .set({
            attempt: canRequeue ? job.attempt + 1 : job.attempt,
            phase: canRequeue ? 'queued' : 'runner_lost',
            outcome: canRequeue ? null : 'runner_lost',
            status: canRequeue ? 'running' : 'interrupted',
            updatedAt: now,
            errorCode: 'RUNNER_LOST',
            errorMessage: 'Runner lease expired',
          })
          .where(eq(runs.id, job.runId));
      });
      results.push({
        jobId: job.id,
        runId: job.runId,
        requeued: canRequeue,
        phase: canRequeue ? 'queued' : 'runner_lost',
        status: canRequeue ? 'queued' : 'failed',
      });
    }
    return results;
  }

  async getReadiness(
    releaseId: string,
    workspaceId = 'default-workspace',
  ): Promise<ReleaseReadiness> {
    const run = (
      await this.db
        .select()
        .from(runs)
        .where(
          and(
            eq(runs.releaseId, releaseId),
            eq(runs.workspaceId, workspaceId),
            isNotNull(runs.completedAt),
          ),
        )
        .orderBy(desc(runs.completedAt))
        .limit(1)
    )[0];
    const mapped = run ? await this.mapRun(rowValue(run)) : null;
    let gate = mapped ? await this.getGate(mapped.id) : null;
    if (mapped && !gate) {
      const policies = await this.listPolicies(workspaceId);
      const policy = policies[0] ?? (await this.createPolicy(defaultPolicy(workspaceId)));
      gate = await this.saveGate(
        createGateEvaluation({
          run: mapped,
          policy,
          domainStatuses: {
            browser:
              mapped.outcome === 'passed'
                ? 'passed'
                : mapped.outcome === 'failed'
                  ? 'failed'
                  : mapped.outcome === 'partial'
                    ? 'warning'
                    : 'unknown',
          },
        }),
      );
    }
    const browser: DomainStatus =
      mapped?.outcome === 'passed'
        ? 'passed'
        : mapped?.outcome === 'failed'
          ? 'failed'
          : mapped?.outcome === 'partial'
            ? 'warning'
            : 'unknown';
    return {
      releaseId,
      decision: gate?.decision ?? 'unknown',
      browser,
      domains: {
        browser,
        api: 'not_configured',
        mobile: 'not_configured',
        performance: 'not_configured',
        security: 'not_configured',
        accessibility: 'not_configured',
        other: 'not_configured',
      },
      latestRunId: mapped?.id ?? null,
      gate,
      evaluatedAt: iso(nowDate(this.options)),
    };
  }

  async getReleaseReadiness(workspaceId: string, releaseId: string): Promise<ReleaseReadiness> {
    return this.getReadiness(releaseId, workspaceId);
  }

  private async findByIdempotency(
    workspaceId: string,
    idempotencyKey: string,
  ): Promise<DbRow | null> {
    const row = (
      await this.db
        .select()
        .from(runs)
        .where(and(eq(runs.workspaceId, workspaceId), eq(runs.idempotencyKey, idempotencyKey)))
        .limit(1)
    )[0];
    return row ? rowValue(row) : null;
  }

  private async mapRun(row: DbRow): Promise<ExecutionRun> {
    const [mapped] = await this.mapRuns([row]);
    return mapped as ExecutionRun;
  }

  /**
   * Maps many run rows with a fixed number of queries.
   *
   * `mapRun` fetches this run's tests, artifacts and runner, so calling it per
   * row made the listing N+1: twenty runs on a dashboard meant sixty-one round
   * trips. Here the child rows for every run are fetched in three queries and
   * grouped in memory, so the count is constant whatever the page size.
   *
   * Kept as a separate method rather than folded into `mapRun` because the
   * single-run path is the common one for a completion and a dashboard, and
   * * three `WHERE run_id = $1` queries beat three `IN (...)` queries for one id.
   */
  private async mapRuns(rowsToMap: DbRow[]): Promise<ExecutionRun[]> {
    if (rowsToMap.length === 0) return [];
    if (rowsToMap.length === 1)
      return [
        await this.mapRunWithChildren(
          rowsToMap[0] as DbRow,
          await this.childrenFor([rowsToMap[0] as DbRow]),
        ),
      ];

    const runIds = rowsToMap.map((row) => stringValue(row['id']));
    const runnerIds = [
      ...new Set(
        rowsToMap
          .map((row) => row['runnerId'])
          .filter((value): value is string => typeof value === 'string' && value !== '')
          .map((value) => stringValue(value)),
      ),
    ];

    const [testRows, artifactRows, runnerRows] = await Promise.all([
      this.db.select().from(tests).where(inArray(tests.runId, runIds)),
      this.db.select().from(artifacts).where(inArray(artifacts.runId, runIds)),
      runnerIds.length === 0
        ? Promise.resolve([])
        : this.db.select().from(runners).where(inArray(runners.id, runnerIds)),
    ]);

    const testsByRun = groupBy(
      testRows.map((row) => rowValue(row)),
      (row) => stringValue(row['runId'], ''),
    );
    const artifactsByRun = groupBy(
      artifactRows.map((row) => rowValue(row)),
      (row) => stringValue(row['runId'], ''),
    );
    const runnerById = new Map(
      runnerRows.map((row) => {
        const mapped = rowValue(row);
        return [stringValue(mapped['id']), mapRunner(mapped)] as const;
      }),
    );

    return rowsToMap.map((row) => {
      const runId = stringValue(row['id']);
      return this.buildRun(
        row,
        (testsByRun.get(runId) ?? []).map((test) => mapTest(test)),
        (artifactsByRun.get(runId) ?? []).map((artifact) => mapArtifact(artifact)),
        row['runnerId'] ? (runnerById.get(stringValue(row['runnerId'])) ?? null) : null,
      );
    });
  }

  /** The per-row queries, for a single run. */
  private async mapRunWithChildren(
    row: DbRow,
    children: {
      tests: DbRow[];
      artifacts: DbRow[];
      runner: unknown;
    },
  ): Promise<ExecutionRun> {
    return this.buildRun(
      row,
      children.tests.map((test) => mapTest(test)),
      children.artifacts.map((artifact) => mapArtifact(artifact)),
      (children.runner ?? null) as ReturnType<typeof mapRunner> | null,
    );
  }

  /** Child rows for a single run, fetched as three queries. */
  private async childrenFor(rowsToLoad: DbRow[]): Promise<{
    tests: DbRow[];
    artifacts: DbRow[];
    runner: unknown;
  }> {
    const [testRows, artifactRows, runnerRow] = await Promise.all([
      this.db
        .select()
        .from(tests)
        .where(eq(tests.runId, stringValue(rowsToLoad[0]?.['id']))),
      this.db
        .select()
        .from(artifacts)
        .where(eq(artifacts.runId, stringValue(rowsToLoad[0]?.['id']))),
      rowsToLoad[0]?.['runnerId']
        ? this.db
            .select()
            .from(runners)
            .where(eq(runners.id, stringValue(rowsToLoad[0]?.['runnerId'])))
            .limit(1)
        : Promise.resolve([]),
    ]);
    return {
      tests: testRows.map((row) => rowValue(row)),
      artifacts: artifactRows.map((row) => rowValue(row)),
      runner: runnerRow[0] === undefined ? null : rowValue(runnerRow[0]),
    };
  }

  private buildRun(
    row: DbRow,
    testRows: ReturnType<typeof mapTest>[],
    artifactRows: ReturnType<typeof mapArtifact>[],
    runner: ReturnType<typeof mapRunner> | null,
  ): ExecutionRun {
    const runId = stringValue(row['id']);
    const summary = summaryFromRow(row);
    return {
      id: runId,
      externalId: nullableString(row['externalId']),
      source: stringValue(row['source'], 'api'),
      framework: stringValue(row['framework'], 'unknown'),
      adapterVersion: stringValue(row['adapterVersion'], 'unknown'),
      testType: stringValue(row['testType'], 'browser'),
      projectId: nullableString(row['projectId']),
      environmentId: nullableString(row['environmentId']),
      releaseId: nullableString(row['releaseId']),
      branch: nullableString(row['branch']),
      commit: nullableString(row['commitSha']),
      suite: nullableString(row['suite']),
      selection: Array.isArray(row['selection'])
        ? row['selection'].filter((value): value is string => typeof value === 'string')
        : [],
      timeoutMs: numberValue(row['timeoutMs'], 1_800_000),
      priority: numberValue(row['priority']),
      requiredCapabilities: Array.isArray(row['requiredCapabilities'])
        ? row['requiredCapabilities'].filter((value): value is string => typeof value === 'string')
        : [],
      labels: Array.isArray(row['labels'])
        ? row['labels'].filter((value): value is string => typeof value === 'string')
        : [],
      configuration:
        row['config'] && typeof row['config'] === 'object'
          ? (row['config'] as Record<string, unknown>)
          : {},
      metadata:
        row['metadata'] && typeof row['metadata'] === 'object'
          ? (row['metadata'] as Record<string, unknown>)
          : {},
      policyId: nullableString(row['policyId']),
      idempotencyKey: stringValue(row['idempotencyKey'], `legacy:${runId}`),
      workspaceId: stringValue(row['workspaceId'], 'default-workspace'),
      attempt: numberValue(row['attempt'], 1),
      retryOfRunId: nullableString(row['retryOfRunId']),
      phase: phaseValue(row['phase']),
      outcome: outcomeValue(row['outcome']),
      createdAt: dateIso(row['createdAt']),
      updatedAt: dateIso(row['updatedAt']),
      startedAt: nullableDateIso(row['startedAt']),
      completedAt: nullableDateIso(row['completedAt']),
      runner: runner
        ? {
            id: runner.id,
            name: runner.name,
            version: runner.version,
            os: runner.os,
            arch: runner.arch,
            health: runner.health,
            lastHeartbeatAt: runner.lastHeartbeatAt,
          }
        : null,
      tests: testRows,
      summary,
      error:
        row['errorCode'] || row['errorMessage']
          ? {
              code: stringValue(row['errorCode'], 'EXECUTION_ERROR'),
              message: stringValue(row['errorMessage'], 'Execution failed'),
            }
          : null,
      rawEvidenceRefs: Array.isArray(row['rawEvidenceRefs'])
        ? row['rawEvidenceRefs'].filter((value): value is string => typeof value === 'string')
        : [],
      artifacts: artifactRows,
      policyEvaluation: null,
      status: stringValue(row['status'], 'running'),
    };
  }

  async create(
    input: CreateRunInput,
    idempotencyKey: string,
    workspaceId?: string,
  ): Promise<CreateRunResult> {
    return this.createRun(input, idempotencyKey, workspaceId);
  }

  async list(workspaceId?: string, releaseId?: string): Promise<ExecutionRun[]> {
    return this.listRuns(workspaceId, releaseId);
  }

  async get(runId: string, workspaceId?: string): Promise<ExecutionRun | null> {
    return this.getRun(runId, workspaceId);
  }

  async cancel(runId: string, workspaceId?: string): Promise<ExecutionRun | null> {
    return this.cancelRun(runId, workspaceId);
  }

  async retry(
    runId: string,
    workspaceId?: string,
    idempotencyKey?: string,
  ): Promise<CreateRunResult | null> {
    return this.retryRun(runId, workspaceId, idempotencyKey);
  }
}

export function createDrizzleExecutionStore(
  db: AnyPgDb,
  options: Omit<DrizzleExecutionStoreOptions, 'db'> = {},
): DrizzleExecutionStore {
  return new DrizzleExecutionStore({ ...options, db });
}
