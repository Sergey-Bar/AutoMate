import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import type {
  SpoolConflictReason,
  SpoolEntry,
  SpoolQueue,
  SpoolRetryPolicy,
} from '@automate/runner-sdk';
import {
  QA_CONTRACT_VERSION,
  type RunPhase,
  type TerminalCanonicalTestStatus,
} from '@automate/shared-contracts';
import { RunnerConfigurationError, type ExecutionProvider } from './execution.js';
import {
  ExecutionEventInputSchema,
  type ArtifactDescriptor,
  type ExecutionEventInput,
  type JobClaim,
  type JobCompletion,
  type RunnerHeartbeat,
  RunnerApiError,
} from './protocol.js';

export interface RunnerProtocol {
  heartbeat(request: {
    leaseId?: string;
    activeJobs: string[];
    metrics?: Record<string, unknown>;
  }): Promise<RunnerHeartbeat>;
  claim(request: { capabilities: string[]; labels: string[] }): Promise<JobClaim | null>;
  sendEventBatch(
    jobId: string,
    leaseId: string,
    fencingToken: number,
    events: ExecutionEventInput[],
  ): Promise<{ results: Array<{ eventId: string; sequence: number; status: string }> }>;
  uploadArtifact(
    jobId: string,
    upload: {
      leaseId: string;
      fencingToken: number;
      kind: string;
      name: string;
      testId: string | null;
      contentType: string;
      bytes: Uint8Array;
      checksum: string;
      metadata: Record<string, unknown>;
    },
  ): Promise<ArtifactDescriptor>;
  complete(jobId: string, completion: JobCompletion): Promise<unknown>;
}

export interface RunnerServiceOptions {
  runnerId: string;
  capabilities: readonly string[];
  labels: readonly string[];
  slots: number;
  pollIntervalMs: number;
  heartbeatIntervalMs: number;
  redactions?: readonly string[];
  protocol: RunnerProtocol;
  executor: ExecutionProvider;
  spool: SpoolQueue;
  retryPolicy?: SpoolRetryPolicy;
  now?: () => Date;
  onError?: (error: unknown) => void;
}

interface ActiveJob {
  leaseId: string;
  phase: RunPhase;
  controller: AbortController;
  sequence: number;
  eventChain: Promise<void>;
  promise: Promise<void>;
}

interface DeliveryOutcome {
  settled: boolean;
  conflict?: SpoolConflictReason;
}

const TERMINAL_SPOOL_CONFLICTS = new Set<SpoolConflictReason>([
  'stale_lease',
  'terminal_event',
  'event_hash_mismatch',
  'run_not_found',
]);

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function terminalTestStatus(value: unknown): TerminalCanonicalTestStatus {
  if (value === 'passed' || value === 'failed' || value === 'flaky' || value === 'skipped')
    return value;
  if (value === 'timedOut') return 'timed_out';
  if (value === 'interrupted') return 'cancelled';
  return 'unknown';
}

type EventDraft = {
  type: ExecutionEventInput['type'];
  payload: ExecutionEventInput['payload'];
};

const MAX_EVENT_BATCH = 100;

type TerminalStatus =
  | 'passed'
  | 'failed'
  | 'partial'
  | 'cancelled'
  | 'timed_out'
  | 'runner_lost'
  | 'infra_failed'
  | 'config_failed'
  | 'blocked';

function terminal(
  claim: JobClaim,
  status: TerminalStatus,
  finishedAt: Date,
  error?: { code: string; message: string },
): JobCompletion {
  const phases: Record<TerminalStatus, JobCompletion['phase']> = {
    passed: 'complete',
    failed: 'complete',
    partial: 'partial',
    cancelled: 'cancelled',
    timed_out: 'timed_out',
    runner_lost: 'runner_lost',
    infra_failed: 'infra_failed',
    config_failed: 'config_failed',
    blocked: 'blocked',
  };
  return {
    jobId: claim.jobId,
    runId: claim.runId,
    leaseId: claim.leaseId,
    fencingToken: claim.fencingToken,
    attempt: claim.attempt,
    status,
    phase: phases[status],
    outcome: status,
    finishedAt: finishedAt.toISOString(),
    artifactIds: [],
    ...(error ? { error } : {}),
  };
}

function conflictFromStatus(status: string | undefined): SpoolConflictReason | undefined {
  if (
    status === 'stale_lease' ||
    status === 'terminal_event' ||
    status === 'sequence_gap' ||
    status === 'event_hash_mismatch' ||
    status === 'run_not_found'
  ) {
    return status;
  }
  return undefined;
}

function conflictFromError(error: unknown): SpoolConflictReason | undefined {
  if (error instanceof RunnerApiError && (error.status === 409 || error.code === 'stale_lease')) {
    return 'stale_lease';
  }
  return undefined;
}

export class RunnerService {
  private readonly active = new Map<string, ActiveJob>();
  private readonly lifecycle = new AbortController();
  private readonly now: () => Date;
  private readonly onError: (error: unknown) => void;
  private readonly retryPolicy: SpoolRetryPolicy;
  private running = false;
  private stopping = false;
  private ready = false;
  private lastHeartbeatAt = 0;
  private flushPromise: Promise<void> | null = null;
  private flushAgain = false;
  private flushNotBefore = 0;

  constructor(private readonly options: RunnerServiceOptions) {
    this.now = options.now ?? (() => new Date());
    this.retryPolicy = options.retryPolicy ?? {
      maxAttempts: 8,
      baseDelayMs: 250,
      maxDelayMs: 30_000,
    };
    this.onError =
      options.onError ??
      ((error) => {
        const code = error instanceof Error ? error.name : 'RUNNER_ERROR';
        console.error(`runner job failed (${code})`);
      });
  }

  isReady(): boolean {
    return this.ready && this.running && !this.stopping;
  }

  activeJobIds(): string[] {
    return [...this.active.keys()];
  }

  async run(externalSignal?: AbortSignal): Promise<void> {
    const forwardAbort = (): void => this.lifecycle.abort();
    externalSignal?.addEventListener('abort', forwardAbort, { once: true });
    if (externalSignal?.aborted) this.lifecycle.abort();
    this.running = true;
    this.stopping = false;
    try {
      while (!this.lifecycle.signal.aborted) {
        await this.tick();
        await this.wait(this.options.pollIntervalMs);
      }
    } finally {
      this.stopping = true;
      this.ready = false;
      for (const job of this.active.values()) job.controller.abort();
      const active = [...this.active.values()].map((job) => job.promise);
      await Promise.allSettled(active);
      this.running = false;
      externalSignal?.removeEventListener('abort', forwardAbort);
    }
  }

  stop(): void {
    this.stopping = true;
    this.lifecycle.abort();
  }

  cancel(jobId: string): boolean {
    const job = this.active.get(jobId);
    if (!job) return false;
    job.controller.abort();
    return true;
  }

  private async tick(): Promise<void> {
    if (this.lifecycle.signal.aborted) return;
    try {
      if (this.options.spool.pending() > 0) void this.scheduleFlush();
      if (this.now().getTime() - this.lastHeartbeatAt >= this.options.heartbeatIntervalMs) {
        await this.heartbeat();
      }
      while (!this.lifecycle.signal.aborted && this.active.size < this.options.slots) {
        const claim = await this.options.protocol.claim({
          capabilities: [...this.options.capabilities],
          labels: [...this.options.labels],
        });
        if (!claim) break;
        this.startClaim(claim);
      }
      this.ready = true;
    } catch (error) {
      this.ready = false;
      this.onError(error);
    }
  }

  private async heartbeat(): Promise<void> {
    const active = this.activeJobIds();
    const first = this.active.values().next().value as ActiveJob | undefined;
    const response = await this.options.protocol.heartbeat({
      ...(first ? { leaseId: first.leaseId } : {}),
      activeJobs: active,
      metrics: { activeJobs: active.length, slots: this.options.slots },
    });
    this.lastHeartbeatAt = this.now().getTime();
    for (const jobId of new Set([...response.cancelledJobIds, ...response.cancelRequestedJobIds])) {
      this.cancel(jobId);
    }
  }

  private startClaim(claim: JobClaim): void {
    const controller = new AbortController();
    const state: ActiveJob = {
      leaseId: claim.leaseId,
      phase: 'assigned',
      controller,
      sequence: this.options.spool.lastSequence(claim.jobId),
      eventChain: Promise.resolve(),
      promise: Promise.resolve(),
    };
    this.active.set(claim.jobId, state);
    state.promise = this.executeClaim(claim, state).catch(this.onError);
    state.promise.finally(() => this.active.delete(claim.jobId));
  }

  private async executeClaim(claim: JobClaim, state: ActiveJob): Promise<void> {
    let workspacePath: string | undefined;
    let completionAttempted = false;
    const complete = async (completion: JobCompletion): Promise<void> => {
      state.eventChain = state.eventChain
        .catch(() => undefined)
        .then(async () => {
          await this.options.spool.enqueue(
            this.entry(claim, 'completion', state.sequence, randomUUID(), completion),
          );
        });
      await state.eventChain;
      completionAttempted = true;
      await this.scheduleFlush();
    };
    try {
      const specification = record(claim.spec['configuration']);
      await this.event(claim, state, {
        type: 'run.assigned',
        payload: {
          phase: 'assigned',
          outcome: null,
          jobId: claim.jobId,
          runnerId: this.options.runnerId,
        },
      });
      await this.transition(claim, state, 'preparing');
      await this.event(claim, state, {
        type: 'run.started',
        payload: {
          phase: 'running',
          outcome: null,
          startedAt: this.now().toISOString(),
          branch: stringValue(claim.spec['branch']),
          commit: stringValue(claim.spec['commit']),
        },
      });
      state.phase = 'running';
      const project = stringValue(specification['playwrightProject']);
      const targetUrl =
        stringValue(specification['targetUrl']) ?? stringValue(specification['baseUrl']);
      const remainingLeaseMs = Math.max(
        1,
        new Date(claim.leaseExpiresAt).getTime() - this.now().getTime(),
      );
      const result = await this.options.executor.execute({
        jobId: claim.jobId,
        targetUrl,
        project,
        deadlineMs: Math.min(claim.timeoutMs, remainingLeaseMs),
        signal: state.controller.signal,
        redactions: [...(this.options.redactions ?? [])],
        onEvent: async (event) => {
          const draft = this.reporterEvent(claim, event);
          if (draft) await this.event(claim, state, draft);
        },
      });
      workspacePath = result.workspacePath;
      await state.eventChain;
      await this.transition(claim, state, 'collecting');
      const artifactIds: string[] = [];
      for (const artifact of result.artifacts) {
        const bytes = await readFile(artifact.path);
        const descriptor = await this.options.protocol.uploadArtifact(claim.jobId, {
          leaseId: claim.leaseId,
          fencingToken: claim.fencingToken,
          kind: artifact.kind,
          name: basename(artifact.name),
          testId: null,
          contentType: artifact.contentType,
          bytes,
          checksum: artifact.digest,
          metadata: { path: artifact.name, sizeBytes: artifact.bytes },
        });
        artifactIds.push(descriptor.id);
        await this.event(claim, state, {
          type: 'artifact.created',
          payload: { artifact: descriptor },
        });
      }
      const status: TerminalStatus = result.status === 'succeeded' ? 'passed' : result.status;
      const completion = terminal(claim, status, this.now(), result.error);
      await this.completionEvent(claim, state, completion, artifactIds);
      await complete(completion);
    } catch (error) {
      if (completionAttempted) {
        this.onError(error);
      } else {
        const status: TerminalStatus = state.controller.signal.aborted
          ? 'cancelled'
          : error instanceof RunnerConfigurationError
            ? 'config_failed'
            : 'infra_failed';
        const message = error instanceof Error ? error.message : 'Runner execution failed';
        const completion = terminal(claim, status, this.now(), {
          code:
            status === 'cancelled'
              ? 'RUNNER_CANCELLED'
              : status === 'config_failed'
                ? 'CONFIG_FAILED'
                : 'RUNNER_INFRA_FAILED',
          message,
        });
        await this.completionEvent(claim, state, completion, []).catch(this.onError);
        await complete(completion).catch(this.onError);
      }
    } finally {
      if (workspacePath && this.options.executor.cleanup) {
        await this.options.executor.cleanup(workspacePath).catch(this.onError);
      }
    }
  }

  private async completionEvent(
    claim: JobClaim,
    state: ActiveJob,
    completion: JobCompletion,
    artifactIds: string[],
  ): Promise<void> {
    if (!completion.phase) throw new Error('Completion phase is required');
    await this.event(claim, state, {
      type: 'run.completed',
      payload: {
        phase: completion.phase,
        outcome: completion.outcome,
        finishedAt: completion.finishedAt,
        error: completion.error ?? null,
        artifactIds,
      },
    });
  }

  private async transition(claim: JobClaim, state: ActiveJob, phase: RunPhase): Promise<void> {
    await this.event(claim, state, {
      type: 'run.phase_changed',
      payload: { previousPhase: state.phase, phase, outcome: null },
    });
    state.phase = phase;
  }

  private reporterEvent(
    claim: JobClaim,
    event: {
      eventId: string;
      type: string;
      occurredAt: string;
      payload: Record<string, unknown>;
    },
  ): EventDraft | undefined {
    const payload = record(event.payload);
    const testId = stringValue(payload['testId']) ?? event.eventId;
    if (event.type === 'test.started') {
      return {
        type: 'test.started',
        payload: {
          testId,
          attempt: numberValue(payload['attempt'], claim.attempt),
          status: 'running',
          title: stringValue(payload['title']),
          suite: stringValue(payload['suite']),
          file: stringValue(payload['file']),
          startedAt: event.occurredAt,
        },
      };
    }
    if (event.type !== 'test.completed') return undefined;
    const status = terminalTestStatus(payload['status']);
    const firstError = Array.isArray(payload['errors']) ? record(payload['errors'][0]) : {};
    return {
      type: 'test.completed',
      payload: {
        testId,
        attempt: numberValue(payload['attempt'], claim.attempt),
        status,
        title: stringValue(payload['title']),
        suite: stringValue(payload['suite']),
        file: stringValue(payload['file']),
        finishedAt: event.occurredAt,
        durationMs: numberValue(payload['durationMs'], 0),
        error:
          status === 'failed' || status === 'timed_out'
            ? {
                code: 'PLAYWRIGHT_TEST_FAILED',
                message: stringValue(firstError['message']) ?? 'Playwright test failed',
              }
            : null,
        artifactIds: [],
      },
    };
  }

  private async event(claim: JobClaim, state: ActiveJob, draft: EventDraft): Promise<void> {
    const event: ExecutionEventInput = ExecutionEventInputSchema.parse({
      version: QA_CONTRACT_VERSION,
      runId: claim.runId,
      eventId: randomUUID(),
      sequence: ++state.sequence,
      occurredAt: this.now().toISOString(),
      ...draft,
    });
    state.eventChain = state.eventChain
      .catch(() => undefined)
      .then(async () => {
        await this.options.spool.enqueue(
          this.entry(claim, 'event', event.sequence, event.eventId, event),
        );
        await this.scheduleFlush();
      });
    await state.eventChain;
  }

  private entry(
    claim: JobClaim,
    kind: SpoolEntry['kind'],
    sequence: number,
    id: string,
    payload: unknown,
  ): SpoolEntry {
    return {
      id,
      jobId: claim.jobId,
      kind,
      sequence,
      leaseId: claim.leaseId,
      fencingToken: claim.fencingToken,
      payload,
    };
  }

  private scheduleFlush(): Promise<void> {
    if (this.flushPromise) {
      this.flushAgain = true;
      return this.flushPromise;
    }
    const run = async (): Promise<void> => {
      do {
        this.flushAgain = false;
        const waitMs = this.flushNotBefore - Date.now();
        if (waitMs > 0) await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
        await this.flush();
      } while (this.flushAgain && !this.stopping && !this.lifecycle.signal.aborted);
    };
    this.flushPromise = run()
      .catch(this.onError)
      .finally(() => {
        this.flushPromise = null;
        if (this.flushAgain) void this.scheduleFlush();
      });
    return this.flushPromise;
  }

  private async flush(): Promise<void> {
    const pending = await this.options.spool.peek(MAX_EVENT_BATCH);
    let index = 0;
    const settledIds: string[] = [];
    while (index < pending.length) {
      const batch = this.batch(pending, index);
      let outcome: DeliveryOutcome;
      try {
        outcome = await this.deliver(batch);
      } catch (error) {
        this.onError(error);
        this.flushNotBefore = Date.now() + this.retryPolicy.baseDelayMs;
        return;
      }
      if (!outcome.settled) {
        if (outcome.conflict && TERMINAL_SPOOL_CONFLICTS.has(outcome.conflict)) {
          settledIds.push(...batch.map((entry) => entry.id));
          index += batch.length;
          this.onError(new Error(`Runner spool entry permanently rejected (${outcome.conflict})`));
          continue;
        }
        this.onError(new Error('Runner spool entries are not acknowledged and stay queued'));
        this.flushNotBefore = Date.now() + this.retryPolicy.baseDelayMs;
        return;
      }
      settledIds.push(...batch.map((entry) => entry.id));
      index += batch.length;
    }
    if (settledIds.length === 0) return;
    try {
      await this.options.spool.ack(settledIds);
      this.flushNotBefore = 0;
    } catch (error) {
      this.onError(error);
      this.flushNotBefore = Date.now() + this.retryPolicy.baseDelayMs;
    }
  }

  private batch(pending: readonly SpoolEntry[], index: number): SpoolEntry[] {
    const head = pending[index];
    if (!head) return [];
    if (head.kind !== 'event') return [head];
    const batch: SpoolEntry[] = [];
    for (const entry of pending.slice(index)) {
      if (
        batch.length >= MAX_EVENT_BATCH ||
        entry.jobId !== head.jobId ||
        entry.kind !== head.kind
      ) {
        break;
      }
      batch.push(entry);
    }
    return batch;
  }

  private async deliver(batch: SpoolEntry[]): Promise<DeliveryOutcome> {
    const head = batch[0];
    if (!head) return { settled: true };
    if (head.kind === 'completion') {
      try {
        await this.options.protocol.complete(head.jobId, head.payload as JobCompletion);
        return { settled: true };
      } catch (error) {
        const conflict = conflictFromError(error);
        if (conflict) return { settled: false, conflict };
        throw error;
      }
    }
    const response = await this.options.protocol.sendEventBatch(
      head.jobId,
      head.leaseId,
      head.fencingToken,
      batch.map((entry) => entry.payload as ExecutionEventInput),
    );
    const settled = new Set(
      response.results
        .filter((result) => result.status === 'accepted' || result.status === 'duplicate')
        .map((result) => result.eventId),
    );
    const failed = batch.find(
      (entry) => !settled.has((entry.payload as ExecutionEventInput).eventId),
    );
    if (!failed) return { settled: true };
    const status = response.results.find(
      (result) => result.eventId === (failed.payload as ExecutionEventInput).eventId,
    )?.status;
    return { settled: false, conflict: conflictFromStatus(status) };
  }

  private wait(milliseconds: number): Promise<void> {
    return new Promise((resolveWait) => {
      if (this.lifecycle.signal.aborted) {
        resolveWait();
        return;
      }
      const signal = this.lifecycle.signal;
      function done(): void {
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        resolveWait();
      }
      const abort = (): void => done();
      const timer = setTimeout(done, milliseconds);
      this.lifecycle.signal.addEventListener('abort', abort, { once: true });
    });
  }
}
