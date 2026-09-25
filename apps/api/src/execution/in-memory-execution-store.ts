import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { createGateEvaluation, defaultPolicy } from './quality-gate.js';
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

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonical(item)).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .filter((key) => object[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`)
    .join(',')}}`;
}

function digest(value: unknown): string {
  return createHash('sha256')
    .update(value instanceof Uint8Array ? value : canonical(value))
    .digest('hex');
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

function countTests(tests: ExecutionTestResult[]): ExecutionSummary {
  const summary = emptySummary();
  for (const test of tests) {
    summary.total += 1;
    if (test.status === 'passed') summary.passed += 1;
    if (test.status === 'failed' || test.status === 'timed_out') summary.failed += 1;
    if (test.status === 'flaky') summary.flaky += 1;
    if (test.status === 'skipped') summary.skipped += 1;
    if (test.status === 'blocked') summary.blocked += 1;
    if (
      test.status === 'unknown' ||
      test.status === 'queued' ||
      test.status === 'running' ||
      test.status === 'blocked' ||
      test.status === 'cancelled'
    )
      summary.unknown += 1;
  }
  const durations = tests
    .map((test) => test.durationMs)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  summary.durationMs =
    durations.length > 0 ? durations.reduce((sum, value) => sum + value, 0) : null;
  return summary;
}

function defaultStatus(phase: RunPhase): string {
  if (phase === 'complete') return 'passed';
  if (phase === 'cancelled') return 'cancelled';
  if (phase === 'timed_out') return 'timed_out';
  if (phase === 'runner_lost') return 'runner_lost';
  if (phase === 'infra_failed') return 'infra_failed';
  if (phase === 'config_failed') return 'config_failed';
  if (phase === 'blocked') return 'blocked';
  if (phase === 'partial') return 'partial';
  return 'running';
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

function tokenMatches(token: string, expectedHash: string): boolean {
  const actual = Buffer.from(digest(token), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
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
  private readonly completionHashes = new Map<string, string>();
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

  async listRuns(workspaceId?: string, releaseId?: string): Promise<ExecutionRun[]> {
    return [...this.runs.values()]
      .filter((run) => workspaceId === undefined || run.workspaceId === workspaceId)
      .filter((run) => releaseId === undefined || run.releaseId === releaseId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((run) => clone(run));
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

  async getJob(jobId: string): Promise<ExecutionJob | null> {
    const job = this.jobs.get(jobId);
    return job ? clone(job) : null;
  }

  async listJobs(workspaceId?: string): Promise<ExecutionJob[]> {
    return [...this.jobs.values()]
      .filter(
        (job) => workspaceId === undefined || this.runs.get(job.runId)?.workspaceId === workspaceId,
      )
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
  ): Promise<JobClaim | null> {
    await this.reapExpiredLeases(now);
    const runner = this.runners.get(runnerId);
    if (!runner || runner.health === 'revoked' || runner.health === 'offline') return null;
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
  ): Promise<EventApplyResult[]> {
    const job = this.jobs.get(jobId);
    if (
      !job ||
      job.state !== 'leased' ||
      job.leaseId !== leaseId ||
      job.fencingToken !== fencingToken ||
      job.leaseExpiresAt === null ||
      new Date(job.leaseExpiresAt).getTime() <= this.now().getTime()
    ) {
      return events.map((event) => ({
        eventId: event.eventId,
        sequence: event.sequence,
        status: 'conflict',
        reason: 'stale_lease',
      }));
    }
    const existing = this.events.get(job.runId) ?? [];
    const byId = new Map<string, { hash: string }>(
      existing.map((event) => [event.eventId, { hash: event.hash }]),
    );
    let sequence = this.nextSequence.get(job.runId) ?? 1;
    let terminal = existing.some(
      (event) =>
        event.type === 'run.completed' ||
        (event.type === 'custom' && event.payload?.['terminal'] === true),
    );
    const prepared: Array<{ input: ExecutionEventInput; hash: string; duplicate: boolean }> = [];
    for (const event of events) {
      if (!event.eventId || !Number.isInteger(event.sequence) || event.sequence < 1) {
        return [
          {
            eventId: event.eventId,
            sequence: event.sequence,
            status: 'conflict',
            reason: 'invalid_event',
          },
        ];
      }
      const hash = digest({
        eventId: event.eventId,
        sequence: event.sequence,
        type: event.type,
        occurredAt: event.occurredAt,
        payload: event.payload ?? {},
      });
      const previous = byId.get(event.eventId);
      if (previous) {
        if (previous.hash !== hash)
          return [
            {
              eventId: event.eventId,
              sequence: event.sequence,
              status: 'conflict',
              reason: 'event_hash_mismatch',
            },
          ];
        prepared.push({ input: event, hash, duplicate: true });
        continue;
      }
      if (event.sequence !== sequence)
        return [
          {
            eventId: event.eventId,
            sequence: event.sequence,
            status: 'conflict',
            reason: 'sequence_gap',
          },
        ];
      if (terminal)
        return [
          {
            eventId: event.eventId,
            sequence: event.sequence,
            status: 'conflict',
            reason: 'terminal_event',
          },
        ];
      prepared.push({ input: event, hash, duplicate: false });
      byId.set(event.eventId, { hash });
      sequence += 1;
      if (event.type === 'run.completed' || event.payload?.['terminal'] === true) terminal = true;
    }
    const timestamp = iso(this.now());
    const results: EventApplyResult[] = [];
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
      const event: ExecutionEvent = {
        eventId: item.input.eventId,
        sequence: item.input.sequence,
        type: item.input.type,
        occurredAt: item.input.occurredAt ?? timestamp,
        payload: clone(item.input.payload ?? {}),
        runId: job.runId,
        jobId,
        leaseId,
        fencingToken,
        receivedAt: timestamp,
        hash: item.hash,
      };
      existing.push(event);
      byId.set(event.eventId, { hash: event.hash });
      this.applyEventToRun(job, event, timestamp);
      results.push({
        eventId: event.eventId,
        sequence: event.sequence,
        status: 'accepted',
        hash: event.hash,
      });
    }
    this.events.set(job.runId, existing);
    this.nextSequence.set(job.runId, sequence);
    return results;
  }

  async listEvents(runId: string): Promise<ExecutionEvent[]> {
    const result: ExecutionEvent[] = [];
    for (const [key, events] of this.events) {
      const job = this.jobs.get(key);
      if (key === runId || job?.runId === runId)
        result.push(...events.map((event) => clone(event)));
    }
    return result.sort((a, b) => a.sequence - b.sequence);
  }

  async getRunEvents(runId: string): Promise<ExecutionEvent[]> {
    return this.listEvents(runId);
  }

  async completeJob(
    jobId: string,
    completion: JobCompletionInput,
  ): Promise<JobCompletionResult | null> {
    const job = this.jobs.get(jobId);
    if (!job) return null;
    const completionHash = digest(completion);
    const previousHash = this.completionHashes.get(jobId);
    if (previousHash) {
      if (previousHash !== completionHash) return null;
      const run = this.runs.get(job.runId);
      return run ? { run: clone(run), job: clone(job), status: 'duplicate' } : null;
    }
    if (
      job.leaseId !== completion.leaseId ||
      job.fencingToken !== completion.fencingToken ||
      job.leaseExpiresAt === null ||
      new Date(job.leaseExpiresAt).getTime() <= this.now().getTime()
    )
      return null;
    const run = this.runs.get(job.runId);
    if (!run) return null;
    const timestamp = iso(this.now());
    const status = (completion.status ?? completion.outcome ?? 'unknown').toLowerCase();
    const requestedPhase = completion.phase;
    const phase: RunPhase =
      requestedPhase === 'completed'
        ? 'complete'
        : (requestedPhase ??
          (status === 'cancelled'
            ? 'cancelled'
            : status === 'timed_out' || status === 'timed-out'
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
      (status === 'passed' || status === 'succeeded' || status === 'success'
        ? 'passed'
        : status === 'failed' || status === 'failure'
          ? 'failed'
          : status === 'cancelled'
            ? 'cancelled'
            : status === 'timed_out' || status === 'timed-out'
              ? 'timed_out'
              : status === 'runner_lost'
                ? 'runner_lost'
                : status === 'infra_failed'
                  ? 'infra_failed'
                  : status === 'config_failed'
                    ? 'config_failed'
                    : 'unknown');
    run.phase = phase;
    run.outcome = outcome;
    run.status = defaultStatus(phase);
    run.completedAt = timestamp;
    run.updatedAt = timestamp;
    if (completion.tests) run.tests = clone(completion.tests);
    if (completion.summary)
      run.summary = { ...run.summary, ...clone(completion.summary) } as ExecutionSummary;
    else run.summary = countTests(run.tests);
    if (completion.error !== undefined)
      run.error =
        completion.error === null
          ? null
          : { code: completion.error.code ?? 'EXECUTION_ERROR', message: completion.error.message };
    job.state =
      status === 'cancelled'
        ? 'cancelled'
        : status === 'failed' || status === 'failure'
          ? 'failed'
          : 'completed';
    job.updatedAt = timestamp;
    job.heartbeatAt = timestamp;
    job.leaseExpiresAt = null;
    job.error =
      completion.error === null || completion.error === undefined
        ? null
        : { code: completion.error.code ?? 'EXECUTION_ERROR', message: completion.error.message };
    this.completionHashes.set(jobId, completionHash);
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
    return { run: clone(run), job: clone(job), status: 'accepted' };
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

  async getArtifact(artifactId: string): Promise<StoredArtifact | null> {
    const artifact = this.artifacts.get(artifactId);
    return artifact ? clone(artifact) : null;
  }

  async listArtifacts(runId: string): Promise<ArtifactDescriptor[]> {
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

  async getGate(runId: string): Promise<GateEvaluation | null> {
    const gate = this.gates.get(runId);
    return gate ? clone(gate) : null;
  }

  async getRunGate(_workspaceId: string, runId: string): Promise<GateEvaluation | null> {
    return this.getGate(runId);
  }

  async reapExpiredLeases(now = this.now()): Promise<LeaseReapResult[]> {
    const results: LeaseReapResult[] = [];
    const timestamp = iso(now);
    for (const job of this.jobs.values()) {
      if (
        job.state !== 'leased' ||
        !job.leaseExpiresAt ||
        new Date(job.leaseExpiresAt).getTime() > now.getTime()
      )
        continue;
      const run = this.runs.get(job.runId);
      const canRequeue = job.attempt < 3 && run !== undefined && !isTerminalPhase(run.phase);
      job.updatedAt = timestamp;
      job.leaseId = null;
      job.leaseOwner = null;
      job.leaseExpiresAt = null;
      job.heartbeatAt = null;
      job.error = { code: 'RUNNER_LOST', message: 'Runner lease expired' };
      if (canRequeue) {
        job.state = 'queued';
        job.attempt += 1;
        job.availableAt = timestamp;
        if (run) {
          run.attempt = job.attempt;
          run.phase = 'queued';
          run.outcome = null;
          run.status = 'queued';
          run.updatedAt = timestamp;
          run.error = { code: 'RUNNER_LOST', message: 'Runner lease expired; job requeued' };
          run.runner = null;
        }
      } else {
        job.state = 'failed';
        if (run) {
          run.phase = 'runner_lost';
          run.outcome = 'runner_lost';
          run.status = 'runner_lost';
          run.completedAt = timestamp;
          run.updatedAt = timestamp;
          run.error = { code: 'RUNNER_LOST', message: 'Runner lease expired' };
          run.runner = null;
        }
      }
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
    const runs = (await this.listRuns(workspaceId, releaseId)).sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
    const latest = runs[0];
    let gate = latest ? await this.getGate(latest.id) : null;
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

  private jobIdForRun(runId: string): string {
    for (const job of this.jobs.values()) if (job.runId === runId) return job.id;
    return '';
  }

  private applyEventToRun(job: ExecutionJob, event: ExecutionEvent, timestamp: string): void {
    const run = this.runs.get(job.runId);
    if (!run) return;
    run.updatedAt = timestamp;
    const payload = event.payload;
    if (
      event.type === 'run.phase' ||
      event.type === 'run.phase_changed' ||
      event.type === 'run.started' ||
      event.type === 'run.queued' ||
      event.type === 'run.assigned'
    ) {
      const phase = normalizePhase(payload['phase']);
      if (phase) {
        run.phase = phase;
        run.status = defaultStatus(phase);
        if (phase === 'complete') run.completedAt = timestamp;
      }
    }
    if (event.type === 'test.started') {
      const id = String(payload['testId'] ?? payload['id'] ?? '');
      if (id) {
        const existing = run.tests.find((test) => test.id === id);
        if (existing) existing.status = 'running';
        else
          run.tests.push({
            id,
            title: String(payload['title'] ?? id),
            file: payload['file'] === undefined ? null : String(payload['file']),
            status: 'running',
          });
        run.summary = countTests(run.tests);
      }
    }
    if (event.type === 'test.completed') {
      const id = String(payload['testId'] ?? payload['id'] ?? '');
      if (id) {
        const status = this.testStatus(payload['status']);
        const existing = run.tests.find((test) => test.id === id);
        if (existing) {
          existing.status = status;
          existing.durationMs =
            typeof payload['durationMs'] === 'number'
              ? payload['durationMs']
              : (existing.durationMs ?? null);
          if (payload['error'] !== undefined) existing.error = this.errorValue(payload['error']);
        } else {
          run.tests.push({
            id,
            title: String(payload['title'] ?? id),
            file: payload['file'] === undefined ? null : String(payload['file']),
            status,
            durationMs: typeof payload['durationMs'] === 'number' ? payload['durationMs'] : null,
            error: this.errorValue(payload['error']),
          });
        }
        run.summary = countTests(run.tests);
      }
    }
    if (event.type === 'run.completed') {
      const phase = normalizePhase(payload['phase']) ?? 'complete';
      const outcome = normalizeOutcome(payload['outcome'] ?? payload['status']);
      run.phase = phase;
      run.outcome = outcome;
      run.status = defaultStatus(phase);
      run.completedAt = timestamp;
      if (payload['error'] !== undefined) run.error = this.errorValue(payload['error']);
      if (
        payload['summary'] !== undefined &&
        payload['summary'] !== null &&
        typeof payload['summary'] === 'object'
      ) {
        const summary = payload['summary'] as Record<string, unknown>;
        run.summary = {
          total: typeof summary['total'] === 'number' ? summary['total'] : run.summary.total,
          passed: typeof summary['passed'] === 'number' ? summary['passed'] : run.summary.passed,
          failed: typeof summary['failed'] === 'number' ? summary['failed'] : run.summary.failed,
          flaky: typeof summary['flaky'] === 'number' ? summary['flaky'] : run.summary.flaky,
          skipped:
            typeof summary['skipped'] === 'number' ? summary['skipped'] : run.summary.skipped,
          blocked:
            typeof summary['blocked'] === 'number' ? summary['blocked'] : run.summary.blocked,
          unknown:
            typeof summary['unknown'] === 'number' ? summary['unknown'] : run.summary.unknown,
          durationMs:
            typeof summary['durationMs'] === 'number'
              ? summary['durationMs']
              : run.summary.durationMs,
        };
      }
    }
  }

  private testStatus(value: unknown): ExecutionTestResult['status'] {
    if (
      value === 'passed' ||
      value === 'failed' ||
      value === 'flaky' ||
      value === 'skipped' ||
      value === 'blocked' ||
      value === 'unknown' ||
      value === 'cancelled' ||
      value === 'timed_out' ||
      value === 'queued' ||
      value === 'running'
    )
      return value;
    return 'unknown';
  }

  private errorValue(value: unknown): { code: string; message: string } | null {
    if (typeof value === 'string') return { code: 'EXECUTION_ERROR', message: value };
    if (typeof value !== 'object' || value === null) return null;
    const object = value as Record<string, unknown>;
    return {
      code: typeof object['code'] === 'string' ? object['code'] : 'EXECUTION_ERROR',
      message: typeof object['message'] === 'string' ? object['message'] : 'Execution failed',
    };
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
