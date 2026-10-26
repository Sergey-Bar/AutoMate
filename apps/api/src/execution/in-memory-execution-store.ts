import { randomBytes, randomUUID } from 'node:crypto';
import { storedTestIdentity, testIdentity } from '@automate/shared-contracts';
import { digestOf, tokenMatches } from './digest.js';
import { normalizeArtifactKind } from './artifact-kind.js';
import { createGateEvaluation, defaultPolicy } from './quality-gate.js';
import { deriveRunState, type DerivedRunState } from './phase-outcome.js';
import {
  completionOutcome,
  completionPhase,
  browserGateStatus,
  completionStatus,
  jobStateFor,
} from './execution-derivations.js';
import { countTests, resolveSummary } from './summary.js';
import { BoundedMap, COMPLETION_HASH_CAPACITY } from './bounded-map.js';
import { normalizeEventLimit, pageRuns } from './run-paging.js';
import {
  isTerminalPhase,
  type ArtifactDescriptor,
  type CreateRunInput,
  type CreateRunResult,
  type DomainName,
  type DomainStatus,
  type ExecutionEvent,
  type ExecutionEventInput,
  type ExecutionJob,
  type ExecutionRun,
  type ExecutionStore,
  type ExecutionStoreOptions,
  type ExecutionSummary,
  type ExecutionTestResult,
  type EventApplyResult,
  type GateEvaluation,
  type JobClaim,
  type RunPage,
  type EventPage,
  type JobCompletionInput,
  type JobCompletionResult,
  type LeaseReapResult,
  type QualityPolicy,
  type ReleaseReadiness,
  type RegisteredRunner,
  type RunnerHealth,
  type RunnerHeartbeat,
  type RunnerManifest,
  type RunOutcome,
  type RunPhase,
  type StoredArtifact,
} from './types.js';

const DEFAULT_LEASE_MS = 60_000;

function iso(value: Date): string {
  return value.toISOString();
}

function clone<T>(value: T): T {
  if (value === undefined || value === null) return value;
  if (value instanceof Uint8Array) return new Uint8Array(value) as T;
  return structuredClone(value);
}

function digest(value: unknown): string {
  return digestOf(value);
}

function emptySummary(): ExecutionSummary {
  return {
    total: 0,
    passed: 0,
    failed: 0,
    flaky: 0,
    skipped: 0,
    blocked: 0,
    unknown: 0,
    durationMs: null,
  };
}

/**
 * Whether a run carries any evidence at all: at least one test, a non-zero
 * declared total, or an explicit outcome of something other than "nothing ran".
 *
 * The product's promise is evidence before claims, and this is the check that
 * keeps a green run from being asserted by a client that ran nothing. A run with
 * no tests and a zero summary resolves to `unknown`, not `passed`.
 */
function hasEvidence(run: { tests: ExecutionTestResult[]; summary: ExecutionSummary }): boolean {
  if (run.tests.length > 0) return true;
  if (run.summary.total > 0) return true;
  if (run.summary.passed > 0 || run.summary.failed > 0 || run.summary.flaky > 0) return true;
  return false;
}

/**
 * Resolves a run's status from its phase and outcome, together.
 *
 * This used to be `if (phase === 'complete') return 'passed'`, which reported a
 * green run for *any* completed phase — including one where no test ever ran.
 * A run with no evidence is not a pass; it is `interrupted`, the existing
 * "finished without a determinate outcome" value, so the status vocabulary stays
 * at four members and no migration is needed.
 */
function statusForTerminal(derived: DerivedRunState, evidence: boolean): string {
  if (derived.outcome === 'passed' && !evidence) return 'interrupted';
  return derived.status;
}

function normalizePhase(value: unknown): RunPhase | null {
  if (typeof value !== 'string') return null;
  const phases: RunPhase[] = [
    'queued',
    'assigned',
    'preparing',
    'running',
    'collecting',
    'normalizing',
    'analyzing',
    'gate_evaluation',
    'complete',
    'cancelled',
    'timed_out',
    'runner_lost',
    'infra_failed',
    'config_failed',
    'blocked',
    'partial',
  ];
  return phases.includes(value as RunPhase) ? (value as RunPhase) : null;
}

function normalizeOutcome(value: unknown): RunOutcome {
  if (
    value === 'passed' ||
    value === 'failed' ||
    value === 'unknown' ||
    value === 'partial' ||
    value === 'cancelled' ||
    value === 'timed_out' ||
    value === 'runner_lost' ||
    value === 'infra_failed' ||
    value === 'config_failed' ||
    value === 'blocked'
  )
    return value;
  return null;
}

function defaultBrowserStatus(run: ExecutionRun | undefined): DomainStatus {
  if (!run) return 'not_configured';
  if (run.outcome === 'passed') return 'passed';
  if (run.outcome === 'failed') return 'failed';
  if (run.outcome === 'partial') return 'warning';
  if (
    run.outcome === 'cancelled' ||
    run.outcome === 'timed_out' ||
    run.outcome === 'runner_lost' ||
    run.outcome === 'infra_failed' ||
    run.outcome === 'config_failed'
  )
    return 'unknown';
  return 'unknown';
}

// ── Event batches ───────────────────────────────────────────────────────────────────────────
//
// Pure helpers behind `appendEvents`. They were inline in one method (cognitive complexity 19);
// each now carries one decision, and `in-memory-store-characterization.test.ts` pins the
// behaviour of the whole.

/** A lease that has no expiry, or whose expiry is at or before `nowMs`, is not live. */
function leaseHasExpired(leaseExpiresAt: string | null, nowMs: number): boolean {
  return leaseExpiresAt === null || new Date(leaseExpiresAt).getTime() <= nowMs;
}

/** Whether `job` is leased to exactly this lease and fencing token, in this workspace, now. */
function holdsAppendLease(
  job: ExecutionJob,
  leaseId: string,
  fencingToken: number,
  workspaceId: string | undefined,
  nowMs: number,
): boolean {
  if (workspaceId !== undefined && job.workspaceId !== workspaceId) return false;
  if (job.state !== 'leased') return false;
  if (job.leaseId !== leaseId || job.fencingToken !== fencingToken) return false;
  return !leaseHasExpired(job.leaseExpiresAt, nowMs);
}

function conflictResult(
  event: Pick<ExecutionEventInput, 'eventId' | 'sequence'>,
  reason: string,
): EventApplyResult {
  return { eventId: event.eventId, sequence: event.sequence, status: 'conflict', reason };
}

function applyResult(
  event: Pick<ExecutionEventInput, 'eventId' | 'sequence'>,
  status: 'accepted' | 'duplicate',
  hash: string,
): EventApplyResult {
  return { eventId: event.eventId, sequence: event.sequence, status, hash };
}

function isMalformedEvent(event: ExecutionEventInput): boolean {
  return !event.eventId || !Number.isInteger(event.sequence) || event.sequence < 1;
}

function eventHash(event: ExecutionEventInput): string {
  return digest({
    eventId: event.eventId,
    sequence: event.sequence,
    type: event.type,
    occurredAt: event.occurredAt,
    payload: event.payload ?? {},
  });
}

/** An incoming event ends the run when it is the completion or says so in its payload. */
function endsTheRun(event: ExecutionEventInput): boolean {
  return event.type === 'run.completed' || event.payload?.['terminal'] === true;
}

/** A stored event ended the run. A payload flag only counts on a `custom` event. */
function storedEventEndedTheRun(event: ExecutionEvent): boolean {
  return (
    event.type === 'run.completed' ||
    (event.type === 'custom' && event.payload?.['terminal'] === true)
  );
}

/** Why a never-seen event cannot be appended, or null. A finished run refuses first. */
function newEventConflict(sequence: number, expected: number, terminal: boolean): string | null {
  if (terminal) return 'terminal_event';
  return sequence === expected ? null : 'sequence_gap';
}

interface PreparedEvent {
  input: ExecutionEventInput;
  hash: string;
  duplicate: boolean;
}

type PreparedBatch =
  | { kind: 'refused'; results: EventApplyResult[] }
  | { kind: 'ready'; prepared: PreparedEvent[]; nextSequence: number };

/**
 * Check a batch against the run's stored events. The first problem refuses the whole batch with
 * that one result, because a partly accepted batch would leave the sequence somewhere the runner
 * cannot reason about.
 */
function prepareBatch(
  events: ExecutionEventInput[],
  existing: ExecutionEvent[],
  firstSequence: number,
): PreparedBatch {
  const hashes = new Map<string, string>(existing.map((event) => [event.eventId, event.hash]));
  let sequence = firstSequence;
  let terminal = existing.some(storedEventEndedTheRun);
  const prepared: PreparedEvent[] = [];
  for (const event of events) {
    if (isMalformedEvent(event)) return refusedBatch(event, 'invalid_event');
    const hash = eventHash(event);
    const refusal = batchRefusal(event, hash, hashes, sequence, terminal);
    if (refusal) return refusedBatch(event, refusal);
    const duplicate = hashes.has(event.eventId);
    prepared.push({ input: event, hash, duplicate });
    if (duplicate) continue;
    hashes.set(event.eventId, hash);
    sequence += 1;
    if (endsTheRun(event)) terminal = true;
  }
  return { kind: 'ready', prepared, nextSequence: sequence };
}

function refusedBatch(event: ExecutionEventInput, reason: string): PreparedBatch {
  return { kind: 'refused', results: [conflictResult(event, reason)] };
}

/** The reason one well-formed event of a batch is refused, or null when it can be taken. */
function batchRefusal(
  event: ExecutionEventInput,
  hash: string,
  hashes: ReadonlyMap<string, string>,
  sequence: number,
  terminal: boolean,
): string | null {
  const stored = hashes.get(event.eventId);
  if (stored !== undefined) return stored === hash ? null : 'event_hash_mismatch';
  return newEventConflict(event.sequence, sequence, terminal);
}

function storedEvent(
  item: PreparedEvent,
  context: {
    job: ExecutionJob;
    jobId: string;
    leaseId: string;
    fencingToken: number;
    timestamp: string;
  },
): ExecutionEvent {
  return {
    eventId: item.input.eventId,
    sequence: item.input.sequence,
    type: item.input.type,
    occurredAt: item.input.occurredAt ?? context.timestamp,
    payload: clone(item.input.payload ?? {}),
    runId: context.job.runId,
    jobId: context.jobId,
    leaseId: context.leaseId,
    fencingToken: context.fencingToken,
    receivedAt: context.timestamp,
    hash: item.hash,
  };
}

// ── Completion ──────────────────────────────────────────────────────────────────────────────

function holdsCompletionLease(
  job: ExecutionJob,
  completion: JobCompletionInput,
  nowMs: number,
): boolean {
  if (job.leaseId !== completion.leaseId || job.fencingToken !== completion.fencingToken) {
    return false;
  }
  return !leaseHasExpired(job.leaseExpiresAt, nowMs);
}

function completionError(error: { code?: string; message: string }): {
  code: string;
  message: string;
} {
  return { code: error.code ?? 'EXECUTION_ERROR', message: error.message };
}

/**
 * Fold a completion into the run. The same derivations the PostgreSQL store uses
 * (`execution-derivations.ts`), so the two cannot derive one completion differently. The
 * runner's own vocabulary is mapped onto the canonical outcome set: the payload can name a pass,
 * not invent an outcome, and it cannot pair an outcome with a phase that forbids one.
 */
function applyCompletionToRun(
  run: ExecutionRun,
  completion: JobCompletionInput,
  timestamp: string,
): void {
  const status = completionStatus(completion);
  const phase = completionPhase(status, completion.phase);
  const claimed = completionOutcome(status, completion.outcome);
  const derived = deriveRunState(phase, claimed);
  if (completion.tests) {
    // The same identity the Drizzle store writes to `tests.stable_id`, so the two stores
    // cannot read one completion as two different tests.
    run.tests = clone(completion.tests).map((test) => ({
      ...test,
      stableId: storedTestIdentity(test),
    }));
  }
  run.summary = resolveSummary(clone(completion.summary), run.tests);
  run.phase = derived.phase;
  run.outcome = derived.outcome;
  run.status = statusForTerminal(derived, hasEvidence(run));
  run.completedAt = timestamp;
  run.updatedAt = timestamp;
  if (completion.error !== undefined) {
    run.error = completion.error === null ? null : completionError(completion.error);
  }
}

function applyCompletionToJob(
  job: ExecutionJob,
  completion: JobCompletionInput,
  timestamp: string,
): void {
  job.state = jobStateFor(completionStatus(completion));
  job.updatedAt = timestamp;
  job.heartbeatAt = timestamp;
  job.leaseExpiresAt = null;
  job.error =
    completion.error === null || completion.error === undefined
      ? null
      : completionError(completion.error);
}

// ── Lease expiry ────────────────────────────────────────────────────────────────────────────

function isExpiredLease(job: ExecutionJob, nowMs: number): boolean {
  if (job.state !== 'leased' || !job.leaseExpiresAt) return false;
  return !(new Date(job.leaseExpiresAt).getTime() > nowMs);
}

/** The lease is gone either way; what happens to the job next is decided by the caller. */
function releaseLostLease(job: ExecutionJob, timestamp: string): void {
  job.updatedAt = timestamp;
  job.leaseId = null;
  job.leaseOwner = null;
  job.leaseExpiresAt = null;
  job.heartbeatAt = null;
  job.error = { code: 'RUNNER_LOST', message: 'Runner lease expired' };
}

function requeueLostJob(job: ExecutionJob, run: ExecutionRun | undefined, timestamp: string): void {
  job.state = 'queued';
  job.attempt += 1;
  job.availableAt = timestamp;
  if (!run) return;
  run.attempt = job.attempt;
  run.phase = 'queued';
  run.outcome = null;
  run.status = 'queued';
  run.updatedAt = timestamp;
  run.error = { code: 'RUNNER_LOST', message: 'Runner lease expired; job requeued' };
  run.runner = null;
}

function failLostJob(job: ExecutionJob, run: ExecutionRun | undefined, timestamp: string): void {
  job.state = 'failed';
  if (!run) return;
  run.phase = 'runner_lost';
  run.outcome = 'runner_lost';
  run.status = 'runner_lost';
  run.completedAt = timestamp;
  run.updatedAt = timestamp;
  run.error = { code: 'RUNNER_LOST', message: 'Runner lease expired' };
  run.runner = null;
}

// ── Folding events into the run ─────────────────────────────────────────────────────────────

/** The events that move a run between phases. A `switch`, as the `||` chain it replaced was. */
function isPhaseEventType(type: string): boolean {
  switch (type) {
    case 'run.phase':
    case 'run.phase_changed':
    case 'run.started':
    case 'run.queued':
    case 'run.assigned':
      return true;
    default:
      return false;
  }
}
const TEST_STATUSES: ReadonlySet<unknown> = new Set([
  'passed',
  'failed',
  'flaky',
  'skipped',
  'blocked',
  'unknown',
  'cancelled',
  'timed_out',
  'queued',
  'running',
]);

function testStatusOf(value: unknown): ExecutionTestResult['status'] {
  return TEST_STATUSES.has(value) ? (value as ExecutionTestResult['status']) : 'unknown';
}

function errorValueOf(value: unknown): { code: string; message: string } | null {
  if (typeof value === 'string') return { code: 'EXECUTION_ERROR', message: value };
  if (typeof value !== 'object' || value === null) return null;
  const object = value as Record<string, unknown>;
  return {
    code: typeof object['code'] === 'string' ? object['code'] : 'EXECUTION_ERROR',
    message: typeof object['message'] === 'string' ? object['message'] : 'Execution failed',
  };
}

function testIdOf(payload: Record<string, unknown>): string {
  return String(payload['testId'] ?? payload['id'] ?? '');
}

function reportedDuration(
  payload: Record<string, unknown>,
  fallback: number | null,
): number | null {
  return typeof payload['durationMs'] === 'number' ? payload['durationMs'] : fallback;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' ? value : fallback;
}

/** The identity a test gets when an event names it for the first time. */
function newTestFrom(
  id: string,
  payload: Record<string, unknown>,
): Pick<ExecutionTestResult, 'id' | 'title' | 'file' | 'stableId'> {
  const title = String(payload['title'] ?? id);
  const file = payload['file'] === undefined ? null : String(payload['file']);
  return {
    id,
    title,
    file,
    // As `DrizzleExecutionStore.upsertTestFromEvent` derives it.
    stableId: testIdentity({
      file: file ?? '',
      describePath: Array.isArray(payload['describePath'])
        ? payload['describePath'].filter((part): part is string => typeof part === 'string')
        : [],
      title,
      project: typeof payload['project'] === 'string' ? payload['project'] : null,
    }),
  };
}

/** Same derivation as the completion path: a non-terminal phase has no outcome, and a
 * `complete` phase with no evidence is not a pass. */
function applyPhaseEvent(
  run: ExecutionRun,
  payload: Record<string, unknown>,
  timestamp: string,
): void {
  const phase = normalizePhase(payload['phase']);
  if (!phase) return;
  const derived = deriveRunState(phase, payload['outcome']);
  run.phase = derived.phase;
  run.outcome = derived.outcome;
  run.status = statusForTerminal(derived, hasEvidence(run));
  if (derived.terminal) run.completedAt = timestamp;
}

function applyTestStarted(run: ExecutionRun, payload: Record<string, unknown>): void {
  const id = testIdOf(payload);
  if (!id) return;
  const existing = run.tests.find((test) => test.id === id);
  if (existing) existing.status = 'running';
  else run.tests.push({ ...newTestFrom(id, payload), status: 'running' });
  run.summary = countTests(run.tests);
}

function applyTestCompleted(run: ExecutionRun, payload: Record<string, unknown>): void {
  const id = testIdOf(payload);
  if (!id) return;
  const status = testStatusOf(payload['status']);
  const existing = run.tests.find((test) => test.id === id);
  if (existing) {
    existing.status = status;
    existing.durationMs = reportedDuration(payload, existing.durationMs ?? null);
    if (payload['error'] !== undefined) existing.error = errorValueOf(payload['error']);
  } else {
    run.tests.push({
      ...newTestFrom(id, payload),
      status,
      durationMs: reportedDuration(payload, null),
      error: errorValueOf(payload['error']),
    });
  }
  run.summary = countTests(run.tests);
}

/** The reported counts replace the run's own, one by one, only where they are numbers. */
function mergeSummary(
  current: ExecutionSummary,
  reported: Record<string, unknown>,
): ExecutionSummary {
  return {
    total: numberOr(reported['total'], current.total),
    passed: numberOr(reported['passed'], current.passed),
    failed: numberOr(reported['failed'], current.failed),
    flaky: numberOr(reported['flaky'], current.flaky),
    skipped: numberOr(reported['skipped'], current.skipped),
    blocked: numberOr(reported['blocked'], current.blocked),
    unknown: numberOr(reported['unknown'], current.unknown),
    durationMs: reportedDuration(reported, current.durationMs),
  };
}

function applyRunCompleted(
  run: ExecutionRun,
  payload: Record<string, unknown>,
  timestamp: string,
): void {
  const phase = normalizePhase(payload['phase']) ?? 'complete';
  if (payload['error'] !== undefined) run.error = errorValueOf(payload['error']);
  const reported = payload['summary'];
  if (typeof reported === 'object' && reported !== null) {
    run.summary = mergeSummary(run.summary, reported as Record<string, unknown>);
  }
  // Derived after the summary is folded in, so a run reporting a zero total
  // cannot be recorded as a pass.
  const derived = deriveRunState(phase, normalizeOutcome(payload['outcome'] ?? payload['status']));
  run.phase = derived.phase;
  run.outcome = derived.outcome;
  run.status = statusForTerminal(derived, hasEvidence(run));
  run.completedAt = timestamp;
}

export class InMemoryExecutionStore implements ExecutionStore {
  private readonly runs = new Map<string, ExecutionRun>();
  private readonly jobs = new Map<string, ExecutionJob>();
  private readonly runners = new Map<string, RegisteredRunner>();
  private readonly runnerTokens = new Map<string, string>();
  private readonly events = new Map<string, ExecutionEvent[]>();
  private readonly nextSequence = new Map<string, number>();
  private readonly artifacts = new Map<string, StoredArtifact>();
  private readonly policies = new Map<string, QualityPolicy>();
  private readonly gates = new Map<string, GateEvaluation>();
  private readonly idempotency = new Map<string, string>();
  /** Bounded: a job completion hash is only consulted while a client retries that job. */
  private readonly completionHashes = new BoundedMap<string, string>(
    'completionHashes',
    COMPLETION_HASH_CAPACITY,
  );
  private readonly now: () => Date;
  private readonly leaseDurationMs: number;

  constructor(options: ExecutionStoreOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.leaseDurationMs = options.leaseDurationMs ?? options.leaseMs ?? DEFAULT_LEASE_MS;
  }

  async createRun(
    input: CreateRunInput,
    idempotencyKey: string,
    workspaceId = 'default-workspace',
  ): Promise<CreateRunResult> {
    const normalizedKey = idempotencyKey.trim();
    if (!normalizedKey) throw new Error('idempotency key is required');
    const mapKey = `${workspaceId}:${normalizedKey}`;
    const existingId = this.idempotency.get(mapKey);
    if (existingId) {
      const existingRun = this.runs.get(existingId);
      const existingJob = existingRun ? this.jobs.get(this.jobIdForRun(existingRun.id)) : undefined;
      if (existingRun && existingJob)
        return { run: clone(existingRun), job: clone(existingJob), duplicate: true };
    }

    const timestamp = iso(this.now());
    const previous = input.retryOfRunId ? this.runs.get(input.retryOfRunId) : undefined;
    const attempt = previous ? previous.attempt + 1 : 1;
    const runId = randomUUID();
    const jobId = randomUUID();
    const run: ExecutionRun = {
      id: runId,
      externalId: input.externalId ?? null,
      source: input.source ?? 'api',
      framework: input.framework ?? 'playwright',
      adapterVersion: input.adapterVersion ?? '1',
      testType: input.testType ?? 'browser',
      projectId: input.projectId ?? null,
      environmentId: input.environmentId ?? null,
      releaseId: input.releaseId ?? null,
      branch: input.branch ?? null,
      commit: input.commit ?? null,
      suite: input.suite ?? null,
      selection: [...(input.selection ?? [])],
      timeoutMs: input.timeoutMs ?? 30 * 60_000,
      priority: input.priority ?? 0,
      requiredCapabilities: [...(input.requiredCapabilities ?? ['playwright'])],
      labels: [...(input.labels ?? [])],
      configuration: clone(input.configuration ?? {}),
      metadata: clone(input.metadata ?? {}),
      policyId: input.policyId ?? null,
      idempotencyKey: normalizedKey,
      workspaceId,
      attempt,
      retryOfRunId: previous?.id ?? input.retryOfRunId ?? null,
      phase: 'queued',
      outcome: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      startedAt: null,
      completedAt: null,
      runner: null,
      tests: [],
      summary: emptySummary(),
      error: null,
      rawEvidenceRefs: [],
      artifacts: [],
      policyEvaluation: null,
      status: 'queued',
    };
    const job: ExecutionJob = {
      id: jobId,
      runId,
      workspaceId: run.workspaceId,
      attempt,
      priority: run.priority,
      state: 'queued',
      availableAt: input.availableAt ?? timestamp,
      requiredCapabilities: [...run.requiredCapabilities],
      labels: [...run.labels],
      leaseId: null,
      leaseOwner: null,
      leaseExpiresAt: null,
      fencingToken: 0,
      heartbeatAt: null,
      idempotencyKey: `${normalizedKey}:attempt:${attempt}`,
      error: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.runs.set(runId, run);
    this.jobs.set(jobId, job);
    this.events.set(runId, []);
    this.nextSequence.set(runId, 1);
    this.idempotency.set(mapKey, runId);
    return { run: clone(run), job: clone(job), duplicate: false };
  }

  async listRuns(
    workspaceId?: string,
    releaseId?: string,
    options?: { limit?: number; after?: string },
  ): Promise<RunPage> {
    const ordered = [...this.runs.values()]
      .filter((run) => workspaceId === undefined || run.workspaceId === workspaceId)
      .filter((run) => releaseId === undefined || run.releaseId === releaseId)
      // **Newest first.** Ordered by id as well as time, because a batch of runs can
      // share a creation time and paging on a non-unique key skips or repeats rows.
      //
      // This was `ASC`, and the limit was applied to the same query, so the listing
      // served the *oldest* N runs in the install. Once an install held more runs than a
      // page, the newest run was on no page: the cursor walks in the same direction as
      // the order, so it could not turn round. An operator opening the dashboard after
      // an incident saw the oldest runs they had.
      .sort((left, right) => {
        const byTime = right.createdAt.localeCompare(left.createdAt);
        return byTime === 0 ? right.id.localeCompare(left.id) : byTime;
      })
      .map((run) => clone(run));
    // The same window the Drizzle store applies, so a page means the same thing
    // on both sides — which is what the store-parity suite holds them to.
    return pageRuns(ordered, options);
  }

  async getRun(runId: string, workspaceId?: string): Promise<ExecutionRun | null> {
    const run = this.runs.get(runId);
    if (!run || (workspaceId !== undefined && run.workspaceId !== workspaceId)) return null;
    return clone(run);
  }

  async cancelRun(runId: string, workspaceId?: string): Promise<ExecutionRun | null> {
    const run = this.runs.get(runId);
    if (!run || (workspaceId !== undefined && run.workspaceId !== workspaceId)) return null;
    if (isTerminalPhase(run.phase)) return clone(run);
    const timestamp = iso(this.now());
    run.phase = 'cancelled';
    run.outcome = 'cancelled';
    run.status = 'cancelled';
    run.completedAt = timestamp;
    run.updatedAt = timestamp;
    for (const job of this.jobs.values()) {
      if (
        job.runId === runId &&
        (job.state === 'queued' || job.state === 'leased' || job.state === 'requeued')
      ) {
        job.state = 'cancelled';
        job.updatedAt = timestamp;
        job.leaseId = null;
        job.leaseOwner = null;
        job.leaseExpiresAt = null;
      }
    }
    return clone(run);
  }

  async retryRun(
    runId: string,
    workspaceId?: string,
    idempotencyKey?: string,
  ): Promise<CreateRunResult | null> {
    const previous = this.runs.get(runId);
    if (!previous || (workspaceId !== undefined && previous.workspaceId !== workspaceId))
      return null;
    if (!isTerminalPhase(previous.phase)) return null;
    const key = idempotencyKey ?? `retry:${previous.id}:${previous.attempt + 1}`;
    const result = await this.createRun(
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
      key,
      previous.workspaceId,
    );
    return result;
  }

  async getJob(jobId: string, workspaceId?: string): Promise<ExecutionJob | null> {
    const job = this.jobs.get(jobId);
    if (!job) return null;
    if (workspaceId !== undefined && job.workspaceId !== workspaceId) return null;
    return clone(job);
  }

  async listJobs(workspaceId?: string): Promise<ExecutionJob[]> {
    return [...this.jobs.values()]
      .filter((job) => workspaceId === undefined || job.workspaceId === workspaceId)
      .map((job) => clone(job));
  }

  async registerRunner(
    manifest: RunnerManifest,
    tokenHash: string,
    tokenExpiresAt: string,
    _workspaceId?: string,
  ): Promise<RegisteredRunner> {
    const timestamp = iso(this.now());
    const existing = this.runners.get(manifest.id);
    const runner: RegisteredRunner = {
      ...clone(manifest),
      capabilities: [...manifest.capabilities],
      labels: [...manifest.labels],
      health: 'healthy',
      tokenHash,
      tokenExpiresAt,
      lastHeartbeatAt: timestamp,
      activeJobIds: existing?.activeJobIds ?? [],
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    };
    this.runners.set(runner.id, runner);
    // Revoke the previous credential. Leaving the old hash mapped would keep a
    // rotated-out token working, which the Drizzle store does not do — the two
    // stores must not disagree on token rotation.
    for (const [hash, mappedRunnerId] of [...this.runnerTokens]) {
      if (mappedRunnerId === runner.id) this.runnerTokens.delete(hash);
    }
    this.runnerTokens.set(tokenHash, runner.id);
    return clone(runner);
  }

  async getRunner(runnerId: string): Promise<RegisteredRunner | null> {
    const runner = this.runners.get(runnerId);
    return runner ? clone(runner) : null;
  }

  async authenticateRunner(token: string): Promise<RegisteredRunner | null> {
    for (const [hash, runnerId] of this.runnerTokens) {
      if (tokenMatches(token, hash)) {
        const runner = this.runners.get(runnerId);
        if (
          !runner ||
          runner.health === 'revoked' ||
          new Date(runner.tokenExpiresAt).getTime() <= this.now().getTime()
        )
          return null;
        return clone(runner);
      }
    }
    return null;
  }

  async heartbeatRunner(
    runnerId: string,
    activeJobIds: string[] = [],
    health: RunnerHealth = 'healthy',
  ): Promise<RunnerHeartbeat | null> {
    const runner = this.runners.get(runnerId);
    if (!runner || runner.health === 'revoked') return null;
    const timestamp = iso(this.now());
    runner.lastHeartbeatAt = timestamp;
    runner.health = health;
    runner.activeJobIds = [...new Set(activeJobIds)];
    runner.updatedAt = timestamp;
    for (const job of this.jobs.values()) {
      if (job.leaseOwner === runnerId && job.state === 'leased') {
        job.heartbeatAt = timestamp;
        job.leaseExpiresAt = iso(new Date(this.now().getTime() + this.leaseDurationMs));
        job.updatedAt = timestamp;
      }
    }
    return { runnerId, health, lastHeartbeatAt: timestamp, activeJobIds: [...runner.activeJobIds] };
  }

  async claimJob(
    runnerId: string,
    capabilities: string[] = [],
    labels: string[] = [],
    now = this.now(),
    workspaceId?: string,
  ): Promise<JobClaim | null> {
    await this.reapExpiredLeases(now);
    const runner = this.runners.get(runnerId);
    if (!runner || runner.health === 'revoked' || runner.health === 'offline') return null;
    const inScope = (job: ExecutionJob): boolean =>
      workspaceId === undefined || job.workspaceId === workspaceId;
    const effectiveCapabilities = new Set([...runner.capabilities, ...capabilities]);
    const effectiveLabels = new Set([...runner.labels, ...labels]);
    const active = [...this.jobs.values()].filter(
      (job) => job.leaseOwner === runnerId && job.state === 'leased',
    );
    if (active.length >= Math.max(1, runner.slots)) return null;
    const timestamp = iso(now);
    const candidates = [...this.jobs.values()]
      .filter(
        (job) =>
          (job.state === 'queued' || job.state === 'requeued') &&
          inScope(job) &&
          new Date(job.availableAt).getTime() <= now.getTime(),
      )
      .filter((job) =>
        job.requiredCapabilities.every((capability) => effectiveCapabilities.has(capability)),
      )
      .filter((job) => job.labels.every((label) => effectiveLabels.has(label)))
      .sort(
        (a, b) =>
          b.priority - a.priority ||
          a.createdAt.localeCompare(b.createdAt) ||
          a.id.localeCompare(b.id),
      );
    const job = candidates[0];
    if (!job) return null;
    const leaseId = randomUUID();
    const fencingToken = job.fencingToken + 1;
    const leaseExpiresAt = iso(new Date(now.getTime() + this.leaseDurationMs));
    job.state = 'leased';
    job.leaseId = leaseId;
    job.leaseOwner = runnerId;
    job.leaseExpiresAt = leaseExpiresAt;
    job.heartbeatAt = timestamp;
    job.fencingToken = fencingToken;
    job.updatedAt = timestamp;
    const run = this.runs.get(job.runId);
    if (run) {
      run.phase = 'assigned';
      run.outcome = null;
      run.status = 'running';
      run.startedAt ??= timestamp;
      run.updatedAt = timestamp;
      run.runner = {
        id: runner.id,
        name: runner.name,
        version: runner.version,
        os: runner.os,
        arch: runner.arch,
        health: runner.health,
        lastHeartbeatAt: runner.lastHeartbeatAt,
      };
    }
    runner.activeJobIds = [...new Set([...runner.activeJobIds, job.id])];
    runner.updatedAt = timestamp;
    return {
      jobId: job.id,
      runId: job.runId,
      attempt: job.attempt,
      leaseId,
      fencingToken,
      timeoutMs: run?.timeoutMs ?? 30 * 60_000,
      spec: run
        ? {
            projectId: run.projectId,
            environmentId: run.environmentId,
            suite: run.suite,
            selection: run.selection,
            configuration: run.configuration,
            framework: run.framework,
            testType: run.testType,
          }
        : {},
      availableAt: job.availableAt,
      leaseExpiresAt,
    };
  }

  async appendEvents(
    jobId: string,
    leaseId: string,
    fencingToken: number,
    events: ExecutionEventInput[],
    workspaceId?: string,
  ): Promise<EventApplyResult[]> {
    const job = this.jobs.get(jobId);
    if (!job || !holdsAppendLease(job, leaseId, fencingToken, workspaceId, this.now().getTime())) {
      return events.map((event) => conflictResult(event, 'stale_lease'));
    }
    const existing = this.events.get(job.runId) ?? [];
    const batch = prepareBatch(events, existing, this.nextSequence.get(job.runId) ?? 1);
    if (batch.kind === 'refused') return batch.results;
    const timestamp = iso(this.now());
    const results: EventApplyResult[] = [];
    for (const item of batch.prepared) {
      if (item.duplicate) {
        results.push(applyResult(item.input, 'duplicate', item.hash));
        continue;
      }
      const event = storedEvent(item, { job, jobId, leaseId, fencingToken, timestamp });
      existing.push(event);
      this.applyEventToRun(job, event, timestamp);
      results.push(applyResult(event, 'accepted', event.hash));
    }
    this.events.set(job.runId, existing);
    this.nextSequence.set(job.runId, batch.nextSequence);
    return results;
  }

  async listEvents(
    workspaceId: string,
    runId: string,
    page: { afterSequence?: number; limit?: number } = {},
  ): Promise<EventPage> {
    // The workspace is required, not optional, so a caller cannot ask for a run
    // it has not proven it owns. An empty page is the answer for a run in another
    // workspace, which is what `GET /api/v1/runs/:runId/events` turns into a 404.
    if (this.runs.get(runId)?.workspaceId !== workspaceId) {
      return { events: [], hasMore: false };
    }
    const limit = normalizeEventLimit(page.limit);
    const all: ExecutionEvent[] = [];
    for (const [key, events] of this.events) {
      const job = this.jobs.get(key);
      if (key === runId || job?.runId === runId) all.push(...events.map((event) => clone(event)));
    }
    all.sort((a, b) => a.sequence - b.sequence);
    const after = page.afterSequence ?? 0;
    const remaining = all.filter((event) => event.sequence > after);
    return { events: remaining.slice(0, limit), hasMore: remaining.length > limit };
  }

  async completeJob(
    jobId: string,
    completion: JobCompletionInput,
    workspaceId?: string,
  ): Promise<JobCompletionResult | null> {
    const job = this.jobs.get(jobId);
    if (!job) return null;
    if (workspaceId !== undefined && job.workspaceId !== workspaceId) return null;
    const completionHash = digest(completion);
    const previousHash = this.completionHashes.get(jobId);
    if (previousHash) return this.replayCompletion(job, previousHash, completionHash);
    if (!holdsCompletionLease(job, completion, this.now().getTime())) return null;
    const run = this.runs.get(job.runId);
    if (!run) return null;
    const timestamp = iso(this.now());
    applyCompletionToRun(run, completion, timestamp);
    applyCompletionToJob(job, completion, timestamp);
    this.completionHashes.set(jobId, completionHash);
    await this.recordCompletionGate(run);
    return { run: clone(run), job: clone(job), status: 'accepted' };
  }

  /** A completion already recorded: the same one is acknowledged, a different one refused. */
  private replayCompletion(
    job: ExecutionJob,
    previousHash: string,
    completionHash: string,
  ): JobCompletionResult | null {
    if (previousHash !== completionHash) return null;
    const run = this.runs.get(job.runId);
    return run ? { run: clone(run), job: clone(job), status: 'duplicate' } : null;
  }

  private async recordCompletionGate(run: ExecutionRun): Promise<void> {
    const policies = await this.listPolicies(run.workspaceId);
    const policy = policies[0] ?? (await this.createPolicy(defaultPolicy(run.workspaceId)));
    await this.saveGate(
      createGateEvaluation({
        run,
        policy,
        domainStatuses: { browser: browserGateStatus(run.outcome) },
      }),
    );
  }

  async addArtifact(
    input: Omit<StoredArtifact, 'id' | 'checksum' | 'sizeBytes' | 'createdAt'> & {
      bytes: Uint8Array;
    },
  ): Promise<ArtifactDescriptor> {
    const run = this.runs.get(input.runId);
    if (!run) throw new Error('run not found');
    const timestamp = iso(this.now());
    const bytes = new Uint8Array(input.bytes);
    const artifact: StoredArtifact = {
      ...input,
      id: randomUUID(),
      kind: normalizeArtifactKind(input.kind),
      checksum: digest(bytes),
      sizeBytes: bytes.byteLength,
      createdAt: timestamp,
      bytes,
    };
    this.artifacts.set(artifact.id, artifact);
    if (!run.artifacts.some((item) => item.id === artifact.id))
      run.artifacts.push(clone({ ...artifact, bytes: undefined } as unknown as StoredArtifact));
    run.updatedAt = timestamp;
    const descriptor = clone(artifact);
    delete (descriptor as Partial<StoredArtifact>).bytes;
    return descriptor;
  }

  async getArtifact(artifactId: string, workspaceId?: string): Promise<StoredArtifact | null> {
    const artifact = this.artifacts.get(artifactId);
    if (!artifact) return null;
    if (workspaceId !== undefined && this.runs.get(artifact.runId)?.workspaceId !== workspaceId)
      return null;
    return clone(artifact);
  }

  async getArtifactDescriptor(
    artifactId: string,
    workspaceId?: string,
  ): Promise<ArtifactDescriptor | null> {
    const artifact = this.artifacts.get(artifactId);
    if (!artifact) return null;
    if (workspaceId !== undefined && this.runs.get(artifact.runId)?.workspaceId !== workspaceId)
      return null;
    const descriptor = clone(artifact);
    delete (descriptor as Partial<StoredArtifact>).bytes;
    return descriptor;
  }

  async listArtifacts(workspaceId: string, runId: string): Promise<ArtifactDescriptor[]> {
    // Required workspace, for the same reason as `listEvents`.
    if (this.runs.get(runId)?.workspaceId !== workspaceId) return [];
    return [...this.artifacts.values()]
      .filter((artifact) => artifact.runId === runId)
      .map((artifact) => {
        const descriptor = clone(artifact);
        delete (descriptor as Partial<StoredArtifact>).bytes;
        return descriptor;
      });
  }

  async createPolicy(
    input: Omit<QualityPolicy, 'id' | 'hash' | 'createdAt' | 'updatedAt'>,
  ): Promise<QualityPolicy> {
    const timestamp = iso(this.now());
    const policy: QualityPolicy = {
      ...clone(input),
      id: randomUUID(),
      requiredDomains: [...input.requiredDomains],
      rules: clone(input.rules),
      hash: digest({ ...input, id: undefined }),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.policies.set(policy.id, policy);
    return clone(policy);
  }

  async listPolicies(workspaceId?: string): Promise<QualityPolicy[]> {
    return [...this.policies.values()]
      .filter((policy) => workspaceId === undefined || policy.workspaceId === workspaceId)
      .map((policy) => clone(policy));
  }

  async getPolicy(policyId: string, workspaceId?: string): Promise<QualityPolicy | null> {
    const policy = this.policies.get(policyId);
    if (!policy || (workspaceId !== undefined && policy.workspaceId !== workspaceId)) return null;
    return clone(policy);
  }

  async saveGate(evaluation: GateEvaluation): Promise<GateEvaluation> {
    this.gates.set(evaluation.runId, clone(evaluation));
    const run = this.runs.get(evaluation.runId);
    if (run) run.policyEvaluation = clone(evaluation);
    return clone(evaluation);
  }

  async getGate(workspaceId: string, runId: string): Promise<GateEvaluation | null> {
    // Required workspace, for the same reason as `listEvents`.
    if (this.runs.get(runId)?.workspaceId !== workspaceId) return null;
    const gate = this.gates.get(runId);
    return gate ? clone(gate) : null;
  }

  async getRunGate(workspaceId: string, runId: string): Promise<GateEvaluation | null> {
    return this.getGate(workspaceId, runId);
  }

  async reapExpiredLeases(now = this.now()): Promise<LeaseReapResult[]> {
    const results: LeaseReapResult[] = [];
    const timestamp = iso(now);
    for (const job of this.jobs.values()) {
      if (!isExpiredLease(job, now.getTime())) continue;
      const run = this.runs.get(job.runId);
      const canRequeue = job.attempt < 3 && run !== undefined && !isTerminalPhase(run.phase);
      releaseLostLease(job, timestamp);
      if (canRequeue) requeueLostJob(job, run, timestamp);
      else failLostJob(job, run, timestamp);
      results.push({
        jobId: job.id,
        runId: job.runId,
        requeued: canRequeue,
        phase: run?.phase ?? 'runner_lost',
        status: canRequeue ? 'queued' : 'failed',
      });
    }
    return results;
  }

  async getReadiness(
    releaseId: string,
    workspaceId = 'default-workspace',
  ): Promise<ReleaseReadiness> {
    // The whole release's runs, not one page: readiness is an aggregate over
    // every run, so the cap does not apply here.
    const { runs } = await this.listRuns(workspaceId, releaseId, {
      limit: Number.MAX_SAFE_INTEGER,
    });
    const ordered = [...runs].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    const latest = ordered[0];
    let gate = latest ? await this.getGate(workspaceId, latest.id) : null;
    if (latest && !gate) {
      const policies = await this.listPolicies(workspaceId);
      const policy = policies[0] ?? (await this.createPolicy(defaultPolicy(workspaceId)));
      gate = await this.saveGate(
        createGateEvaluation({
          run: latest,
          policy,
          domainStatuses: { browser: defaultBrowserStatus(latest) },
        }),
      );
    }
    const browser = defaultBrowserStatus(latest);
    const domains: Record<DomainName, DomainStatus> = {
      browser,
      api: 'not_configured',
      mobile: 'not_configured',
      performance: 'not_configured',
      security: 'not_configured',
      accessibility: 'not_configured',
      other: 'not_configured',
    };
    return {
      releaseId,
      decision: gate?.decision ?? 'unknown',
      browser,
      domains,
      latestRunId: latest?.id ?? null,
      gate,
      evaluatedAt: iso(this.now()),
    };
  }

  async getReleaseReadiness(workspaceId: string, releaseId: string): Promise<ReleaseReadiness> {
    return this.getReadiness(releaseId, workspaceId);
  }

  async create(
    input: CreateRunInput,
    idempotencyKey: string,
    workspaceId?: string,
  ): Promise<CreateRunResult> {
    return this.createRun(input, idempotencyKey, workspaceId);
  }

  async list(workspaceId?: string, releaseId?: string): Promise<ExecutionRun[]> {
    return (await this.listRuns(workspaceId, releaseId)).runs;
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

  private jobIdForRun(runId: string): string {
    for (const job of this.jobs.values()) if (job.runId === runId) return job.id;
    return '';
  }

  private applyEventToRun(job: ExecutionJob, event: ExecutionEvent, timestamp: string): void {
    const run = this.runs.get(job.runId);
    if (!run) return;
    run.updatedAt = timestamp;
    const payload = event.payload;
    if (isPhaseEventType(event.type)) applyPhaseEvent(run, payload, timestamp);
    else if (event.type === 'test.started') applyTestStarted(run, payload);
    else if (event.type === 'test.completed') applyTestCompleted(run, payload);
    else if (event.type === 'run.completed') applyRunCompleted(run, payload, timestamp);
  }
}

export function createExecutionStore(options: ExecutionStoreOptions = {}): ExecutionStore {
  return new InMemoryExecutionStore(options);
}

export function createRunnerToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashRunnerToken(token: string): string {
  return digest(token);
}
