import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
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

export class RunnerService {
  private readonly active = new Map<string, ActiveJob>();
  private readonly lifecycle = new AbortController();
  private readonly now: () => Date;
  private readonly onError: (error: unknown) => void;
  private running = false;
  private stopping = false;
  private ready = false;
  private lastHeartbeatAt = 0;

  constructor(private readonly options: RunnerServiceOptions) {
    this.now = options.now ?? (() => new Date());
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
      sequence: 0,
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
      completionAttempted = true;
      await this.options.protocol.complete(claim.jobId, completion);
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
    state.eventChain = state.eventChain.then(async () => {
      await this.options.protocol.sendEventBatch(claim.jobId, claim.leaseId, claim.fencingToken, [
        event,
      ]);
    });
    await state.eventChain;
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
