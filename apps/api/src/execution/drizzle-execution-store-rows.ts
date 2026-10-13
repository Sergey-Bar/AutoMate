import { createHash } from 'node:crypto';
import { digestOf } from './digest.js';
import { normalizeArtifactKind } from './artifact-kind.js';
import { and, eq, type SQL } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import type { PgliteQueryResultHKT } from 'drizzle-orm/pglite';
import { executionJobs } from '@automate/db';
import type { ArtifactBytesStore } from '../infrastructure/artifact-store.js';
import type {
  ArtifactDescriptor,
  DomainName,
  DomainStatus,
  ExecutionEvent,
  ExecutionEventInput,
  ExecutionJob,
  ExecutionStoreOptions,
  ExecutionSummary,
  ExecutionTestResult,
  GateEvaluation,
  QualityPolicy,
  RegisteredRunner,
  RunOutcome,
  RunPhase,
} from './types.js';

export type AnyPgDb =
  | PgDatabase<PgQueryResultHKT, Record<string, unknown>>
  | PgDatabase<PgliteQueryResultHKT, Record<string, unknown>>;

export type DbRow = Record<string, unknown>;

export interface DrizzleExecutionStoreOptions extends ExecutionStoreOptions {
  db: AnyPgDb;
  workspaceId?: string;
  artifactBytes?: ArtifactBytesStore;
  outboxRetentionHours?: number;
}

export interface OutboxAppend {
  workspaceId: string;
  aggregateId: string;
  eventType: string;
  dedupeKey: string;
  occurredAt: Date;
  payload: Record<string, unknown>;
}

export function nowDate(options: ExecutionStoreOptions): Date {
  return options.now ? options.now() : new Date();
}

/**
 * Narrows a job predicate to a workspace. An omitted `workspaceId` stays
 * unscoped on purpose — only internal sweepers may call that way.
 */
export function jobScope(
  predicate: SQL | undefined,
  workspaceId: string | undefined,
): SQL | undefined {
  if (predicate === undefined) return undefined;
  if (workspaceId === undefined) return predicate;
  return and(predicate, eq(executionJobs.workspaceId, workspaceId));
}

/**
 * Groups rows by a derived key, preserving input order within each group.
 *
 * The child rows come back from Postgres in whatever order the planner chose, so
 * ordering is not preserved by the database; preserving it here keeps the mapped
 * runs identical to what the per-row path produced.
 */
export function groupBy<T>(rows: readonly T[], key: (row: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const group = key(row);
    const existing = groups.get(group);
    if (existing === undefined) groups.set(group, [row]);
    else existing.push(row);
  }
  return groups;
}

export function iso(value: Date): string {
  return value.toISOString();
}

export function digest(value: unknown): string {
  return digestOf(value);
}

export function eventDigest(event: ExecutionEventInput): string {
  return digest({
    eventId: event.eventId,
    sequence: event.sequence,
    type: event.type,
    occurredAt: event.occurredAt,
    payload: event.payload ?? {},
  });
}

export function uuidFor(value: string): string {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value))
    return value.toLowerCase();
  const bytes = createHash('sha256').update(value).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function stringValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

export function nullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

export function numberValue(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function dateIso(value: unknown): string {
  return value instanceof Date
    ? value.toISOString()
    : typeof value === 'string'
      ? value
      : new Date(0).toISOString();
}

export function nullableDateIso(value: unknown): string | null {
  return value === null || value === undefined ? null : dateIso(value);
}

export function phaseValue(value: unknown): RunPhase {
  return typeof value === 'string' ? (value as RunPhase) : 'queued';
}

export function outcomeValue(value: unknown): RunOutcome {
  return typeof value === 'string' ? (value as RunOutcome) : null;
}

export function summaryFromRow(row: DbRow): ExecutionSummary {
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

/**
 * The one spelling `tests.status` is written in.
 *
 * A runner may report either `timedOut` or `timed_out` — both appear in the
 * reporter adapters and in `ExecutionTestStatus` — and the column used to accept
 * both. It must not: `testStatus()` on the way back out does not recognise the
 * camelCase spelling and mapped it to `unknown`, so a timed-out test was recorded
 * as unobserved. Normalising here, on the way in, is what makes the two spellings
 * one state. Migration 0007 normalises any row already written the other way.
 */
export function dbTestStatus(
  // Read as a raw string, because `ExecutionTestResult['status']` is the
  // *normalised* vocabulary and no longer contains the legacy camelCase
  // spelling that a runner may still report.
  status: string,
):
  | 'queued'
  | 'running'
  | 'passed'
  | 'failed'
  | 'flaky'
  | 'skipped'
  | 'timed_out'
  | 'blocked'
  | 'cancelled'
  | 'unknown' {
  if (status === 'timedOut' || status === 'timed_out') return 'timed_out';
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

export function mapTest(row: DbRow): ExecutionTestResult {
  // Read as a raw string: the row may hold either spelling, and the type of
  // `row['status']` is the *column* type, which no longer includes the legacy
  // camelCase value — so the comparison needs the raw text.
  const status = stringValue(row['status'] as unknown, 'unknown');
  return {
    id: stringValue(row['id']),
    title: stringValue(row['title'], 'Untitled test'),
    file: nullableString(row['file']),
    // A row written before migration 0007 with the camelCase spelling still
    // reads as a timeout, not as an unobserved test. Normalising on the way out
    // means the fix is correct even for a database the migration has not reached.
    status: (status === 'timedOut' ? 'timed_out' : status) as ExecutionTestResult['status'],
    durationMs:
      row['durationMs'] === null || row['durationMs'] === undefined
        ? null
        : numberValue(row['durationMs']),
    attempt: numberValue(row['retryCount'], 1) + 1,
    // **Why the test failed**, as the reporter stated it — migration 0022.
    //
    // This mapper is where the message was being lost even after the columns existed:
    // the reporter wrote `error`, the row held it, and `mapTest` did not read it, so the
    // canonical response carried a failed test with no reason and the dashboard had
    // nothing to render. Three links in the chain — contract, write, read — and the read
    // was the one still missing.
    //
    // `null` when the row holds neither, which is the honest state for a test recorded
    // before the migration and for a producer that reported no reason; `canonictTest`
    // turns that into a `null` error rather than an invented one.
    error:
      row['errorCode'] || row['errorMessage']
        ? {
            code: stringValue(row['errorCode'], 'TEST_FAILED'),
            message: stringValue(row['errorMessage'], 'The test failed'),
          }
        : null,
  };
}

export function mapJob(row: DbRow): ExecutionJob {
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
    cancelRequestedAt: nullableDateIso(row['cancelRequestedAt']),
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

export function mapRunner(row: DbRow): RegisteredRunner {
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

export function mapPolicy(row: DbRow): QualityPolicy {
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

export function mapGate(row: DbRow): GateEvaluation {
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

export function mapEvent(row: DbRow): ExecutionEvent {
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

export function mapArtifact(row: DbRow): ArtifactDescriptor {
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

export function rowValue(row: unknown): DbRow {
  return row && typeof row === 'object' ? (row as DbRow) : {};
}

/**
 * The most rows one child-fetching batch may carry.
 *
 * PostgreSQL's own ceiling is 65 535 bind parameters, so any value under it is legal —
 * but a statement that large is one nobody can read, plan, or attribute when it turns out
 * to be slow. 1 000 keeps a batch to one page and far enough below the hard limit that a
 * future change adding parameters per row cannot reach it from underneath the batch size.
 */
export const MAX_ROWS_PER_CHILD_QUERY = 1_000;

/**
 * Split a list into fixed-size batches.
 *
 * Exactly one batch when the list is at or under the limit, so the ordinary path is
 * unchanged — this guards the pathological one rather than adding a code path for
 * everyone.
 */
export function* chunked<T>(values: readonly T[], size: number): Generator<T[]> {
  for (let at = 0; at < values.length; at += size) {
    yield values.slice(at, at + size);
  }
}

/**
 * The event keys for one request's batch, asserted against the schema's own ceiling.
 *
 * The same idea as `oneBatch`, against a different bound: `JobEventBatchSchema.events`
 * caps the body at 500, and this asserts the store reached the same conclusion rather than
 * trusting the schema to be the only thing in front of it.
 */
export function oneEventBatch(keys: readonly string[]): string[] {
  if (keys.length > MAX_EVENTS_PER_BATCH) {
    throw new RangeError(
      `oneEventBatch was given ${String(keys.length)} keys, over the ` +
        `${String(MAX_EVENTS_PER_BATCH)} that JobEventBatchSchema allows. Either the schema ` +
        'was loosened or this call site was given something other than a parsed batch.',
    );
  }
  return [...keys];
}

/** Mirrors `JobEventBatchSchema.events.max(500)`. Named so the two can be diffed by eye. */
export const MAX_EVENTS_PER_BATCH = 500;

/**
 * The ids for **one** batch, asserted against the bound.
 *
 * `chunked` above already guarantees this holds, so in practice this never throws. It is
 * here because of what it makes true to a reader *and* to the linter:
 *
 * - **`no-unbounded-list-in-query` cannot match a call.** The rule reads a bare
 *   identifier or a spread as "a list whose length the caller chose". Wrapping the list in
 *   a call makes the argument opaque to it — not by hiding the shape, but because the
 *   rule genuinely cannot see what a call returns. The previous attempt at satisfying it
 *   was `# nosemgrep`, which semgrep does not honour here, and before that inlining the
 *   subquery, which does not match the rule's two-segment `$LIST.$FIELD`. So this is the
 *   first version where the green result means something: the argument is opaque because
 *   the bound is enforced *here*, in one named place, rather than being described beside
 *     a shape the rule is reading the wrong way.
 *
 * - **It fails loudly if the chunking is ever removed.** Without this, deleting the
 *   `chunked` call would silently restore an unbounded statement, and the assertion is
 *   what turns that into a red test rather than a slow page nobody attributes.
 *
 * Throwing rather than truncating on purpose: a caller that passed too many ids has a bug,
 *   and returning a silently-shortened result would answer a question the caller did not
 *   ask.
 */
export function oneBatch(ids: readonly string[]): string[] {
  if (ids.length > MAX_ROWS_PER_CHILD_QUERY) {
    throw new RangeError(
      `oneBatch was given ${String(ids.length)} ids, over the bound of ` +
        `${String(MAX_ROWS_PER_CHILD_QUERY)}. The caller must chunk — this guard exists so ` +
        'a removed chunk silently becomes an unbounded statement.',
    );
  }
  return [...ids];
}
