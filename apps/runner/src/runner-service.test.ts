import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DurableSpool,
  MemorySpool,
  type SpoolEntry,
  type SpoolQueue,
  type SpoolRetryPolicy,
} from '@automate/runner-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  RunnerConfigurationError,
  type ExecutionContext,
  type ExecutionProvider,
  type ExecutionResult,
} from './execution.js';
import {
  ExecutionEventInputSchema,
  type ArtifactDescriptor,
  type ExecutionEventInput,
  type JobClaim,
  type JobCompletion,
  type RunnerHeartbeat,
} from './protocol.js';
import { RunnerService, type RunnerProtocol, type RunnerServiceOptions } from './runner-service.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })),
  );
});

function claim(jobId = 'job-1'): JobClaim {
  return {
    jobId,
    runId: `run-${jobId}`,
    attempt: 1,
    leaseId: `lease-${jobId}`,
    fencingToken: 3,
    timeoutMs: 10_000,
    spec: {
      configuration: {
        playwrightProject: 'smoke-pass',
        targetUrl: 'https://allowed.test',
      },
    },
    availableAt: new Date().toISOString(),
    leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
}

class FakeProtocol implements RunnerProtocol {
  readonly events: ExecutionEventInput[] = [];
  readonly completions: JobCompletion[] = [];
  readonly artifacts: string[] = [];
  deliverCalls = 0;
  failures = 0;
  conflict = false;
  conflictStatus = 'conflict';
  alwaysFail: Error | null = null;
  onComplete?: () => void;
  private queued: JobClaim[] = [];

  enqueue(value: JobClaim): void {
    this.queued.push(value);
  }

  async heartbeat(): Promise<RunnerHeartbeat> {
    return {
      runnerId: 'runner-1',
      health: 'healthy',
      lastHeartbeatAt: new Date().toISOString(),
      activeJobIds: [],
      cancelledJobIds: [],
      cancelRequestedJobIds: [],
    };
  }

  async claim(): Promise<JobClaim | null> {
    return this.queued.shift() ?? null;
  }

  async sendEventBatch(
    _jobId: string,
    _leaseId: string,
    _fencingToken: number,
    events: ExecutionEventInput[],
  ): Promise<{ results: Array<{ eventId: string; sequence: number; status: string }> }> {
    this.deliverCalls += 1;
    if (this.alwaysFail) throw this.alwaysFail;
    if (this.failures > 0) {
      this.failures -= 1;
      throw new Error('runner API is unreachable');
    }
    this.events.push(...events);
    return {
      results: events.map((event) => ({
        eventId: event.eventId,
        sequence: event.sequence,
        status: this.conflict ? this.conflictStatus : 'accepted',
      })),
    };
  }

  async uploadArtifact(
    jobId: string,
    upload: Parameters<RunnerProtocol['uploadArtifact']>[1],
  ): Promise<ArtifactDescriptor> {
    this.artifacts.push(upload.name);
    return {
      id: `artifact-${upload.name}`,
      runId: `run-${jobId}`,
      jobId,
      testId: null,
      kind: upload.kind,
      name: upload.name,
      contentType: upload.contentType,
      storageKey: `jobs/${jobId}/${upload.name}`,
      checksum: upload.checksum,
      sizeBytes: upload.bytes.byteLength,
      createdAt: new Date().toISOString(),
      expiresAt: null,
      legalHold: false,
      metadata: upload.metadata,
    };
  }

  async complete(_jobId: string, completion: JobCompletion): Promise<unknown> {
    this.deliverCalls += 1;
    if (this.alwaysFail) throw this.alwaysFail;
    if (this.failures > 0) {
      this.failures -= 1;
      throw new Error('runner API is unreachable');
    }
    this.completions.push(completion);
    this.onComplete?.();
    return {};
  }
}

class FailFirstCompletionSpool extends MemorySpool {
  failNextCompletion = true;

  override async enqueue(entry: SpoolEntry): Promise<void> {
    if (entry.kind === 'completion' && this.failNextCompletion) {
      this.failNextCompletion = false;
      throw new Error('spool temporarily unavailable');
    }
    await super.enqueue(entry);
  }
}

class FakeExecutor implements ExecutionProvider {
  readonly cleaned: string[] = [];

  constructor(private readonly behavior: (context: ExecutionContext) => Promise<ExecutionResult>) {}

  execute(context: ExecutionContext): Promise<ExecutionResult> {
    return this.behavior(context);
  }

  async cleanup(workspacePath: string): Promise<void> {
    this.cleaned.push(workspacePath);
  }
}

function service(
  protocol: RunnerProtocol,
  executor: ExecutionProvider,
  spool: SpoolQueue = new MemorySpool(),
  onError: (error: unknown) => void = vi.fn(),
  seams: Pick<RunnerServiceOptions, 'sleep' | 'random' | 'retryPolicy'> = {},
): RunnerService {
  return new RunnerService({
    runnerId: 'runner-1',
    capabilities: ['playwright', 'chromium'],
    labels: ['trusted'],
    slots: 1,
    pollIntervalMs: 1,
    heartbeatIntervalMs: 60_000,
    protocol,
    executor,
    spool,
    onError,
    ...seams,
  });
}

function immediateSleep(_milliseconds: number): Promise<void> {
  return Promise.resolve();
}

/**
 * Yields to the event loop until a condition the service controls holds. Bounded
 * by iteration count rather than by elapsed time, so a condition that never
 * arrives fails with the label below instead of a bare timeout.
 */
async function until(label: string, predicate: () => boolean | Promise<boolean>): Promise<void> {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    if (await predicate()) return;
    await new Promise((resolveTick) => setTimeout(resolveTick, 1));
  }
  throw new Error(`Condition never held: ${label}`);
}

describe('RunnerService', () => {
  it('runs ordered live events, uploads evidence, completes once, and cleans the workspace', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'runner-service-'));
    roots.push(workspace);
    const evidence = join(workspace, 'stdout.log');
    await writeFile(evidence, 'evidence');
    const protocol = new FakeProtocol();
    protocol.enqueue(claim());
    const executor = new FakeExecutor(async (context) => {
      await context.onEvent?.({
        eventId: 'reporter-event-1',
        sequence: 1,
        type: 'test.completed',
        occurredAt: new Date().toISOString(),
        payload: { testId: 'test-1', status: 'passed' },
      });
      return {
        status: 'passed',
        resultPath: join(workspace, 'playwright-report.json'),
        workspacePath: workspace,
        artifacts: [
          {
            path: evidence,
            digest: 'a'.repeat(64),
            bytes: 8,
            kind: 'stdout',
            name: 'stdout.log',
            contentType: 'application/x-ndjson',
          },
        ],
        stdout: 'evidence',
        stderr: '',
      };
    });
    const runner = service(protocol, executor);
    const stop = setTimeout(() => runner.stop(), 10);

    await runner.run();
    clearTimeout(stop);

    expect(protocol.events.map((event) => event.sequence)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(protocol.events.map((event) => event.type)).toEqual([
      'run.assigned',
      'run.phase_changed',
      'run.started',
      'test.completed',
      'run.phase_changed',
      'artifact.created',
      'run.completed',
    ]);
    expect(protocol.artifacts).toEqual(['stdout.log']);
    expect(protocol.completions).toEqual([
      expect.objectContaining({ status: 'passed', phase: 'complete', outcome: 'passed' }),
    ]);
    expect(executor.cleaned).toEqual([workspace]);
  });

  it('keeps cancellation and configuration failure distinct from product failure', async () => {
    const cancellationProtocol = new FakeProtocol();
    cancellationProtocol.enqueue(claim('job-cancel'));
    const control: { runner?: RunnerService } = {};
    const cancellationExecutor = new FakeExecutor(async (context) => {
      control.runner!.cancel('job-cancel');
      control.runner!.stop();
      if (!context.signal.aborted) {
        await new Promise<void>((resolve) =>
          context.signal.addEventListener('abort', () => resolve(), { once: true }),
        );
      }
      return {
        status: 'cancelled',
        resultPath: '',
        workspacePath: '',
        artifacts: [],
        stdout: '',
        stderr: '',
      };
    });
    const runner = service(cancellationProtocol, cancellationExecutor);
    control.runner = runner;
    await runner.run();
    expect(cancellationProtocol.completions[0]).toMatchObject({
      status: 'cancelled',
      phase: 'cancelled',
      outcome: 'cancelled',
    });

    const configProtocol = new FakeProtocol();
    configProtocol.enqueue(claim('job-config'));
    const configExecutor = new FakeExecutor(async () => {
      throw new RunnerConfigurationError('project is not allowlisted');
    });
    const configRunner = service(configProtocol, configExecutor);
    const stop = setTimeout(() => configRunner.stop(), 0);
    await configRunner.run();
    clearTimeout(stop);
    expect(configProtocol.completions[0]).toMatchObject({
      status: 'config_failed',
      phase: 'config_failed',
      outcome: 'config_failed',
    });
  });
});

describe('RunnerService spool delivery', () => {
  it('queues events and completion before sending and replays them in order', async () => {
    const spool = new MemorySpool();
    const protocol = new FakeProtocol();
    protocol.enqueue(claim());
    protocol.failures = 2;
    const pendingOnFailure: number[] = [];
    const errors = vi.fn();
    const runner = service(
      protocol,
      passingExecutor(),
      spool,
      (error: unknown) => {
        pendingOnFailure.push(spool.pending());
        errors(error);
      },
      { sleep: immediateSleep },
    );
    protocol.onComplete = () => runner.stop();

    await runner.run();

    expect(pendingOnFailure.length).toBeGreaterThan(0);
    expect(pendingOnFailure.every((count) => count > 0)).toBe(true);
    expect(protocol.events.map((event) => event.sequence)).toEqual([1, 2, 3, 4, 5]);
    expect(protocol.events.map((event) => event.type)).toEqual([
      'run.assigned',
      'run.phase_changed',
      'run.started',
      'run.phase_changed',
      'run.completed',
    ]);
    expect(protocol.completions).toEqual([
      expect.objectContaining({ status: 'passed', phase: 'complete' }),
    ]);
    expect(spool.pending()).toBe(0);
  });

  it('retries a completion after a transient spool enqueue failure', async () => {
    const spool = new FailFirstCompletionSpool();
    const protocol = new FakeProtocol();
    protocol.enqueue(claim('job-completion-retry'));
    const runner = service(protocol, passingExecutor(), spool);
    const stop = setTimeout(() => runner.stop(), 20);

    await runner.run();
    clearTimeout(stop);

    expect(protocol.completions).toHaveLength(1);
    expect(spool.pending()).toBe(0);
  });

  it('replays entries restored from a previous process and continues the sequence', async () => {
    const spool = new MemorySpool();
    const restored = ExecutionEventInputSchema.parse({
      version: '1',
      runId: 'run-job-1',
      eventId: 'restored-event',
      sequence: 4,
      occurredAt: new Date().toISOString(),
      type: 'test.completed',
      payload: {
        testId: 'test-0',
        attempt: 1,
        status: 'passed',
        finishedAt: new Date().toISOString(),
      },
    });
    await spool.enqueue({
      id: restored.eventId,
      jobId: 'job-1',
      kind: 'event',
      sequence: 4,
      leaseId: 'lease-job-1',
      fencingToken: 2,
      payload: restored,
    });
    const protocol = new FakeProtocol();
    protocol.enqueue(claim());
    const runner = service(protocol, passingExecutor(), spool);
    protocol.onComplete = () => runner.stop();

    await runner.run();

    expect(protocol.events.map((event) => event.sequence)).toEqual([4, 5, 6, 7, 8, 9]);
    expect(protocol.events[0]?.eventId).toBe('restored-event');
    expect(spool.pending()).toBe(0);
    expect(protocol.completions).toHaveLength(1);
  });

  it('dead-letters stale lease entries so a re-claimed job can drain the spool', async () => {
    const spool = new MemorySpool();
    const protocol = new FakeProtocol();
    protocol.conflict = true;
    protocol.conflictStatus = 'stale_lease';
    protocol.enqueue(claim('job-stale'));
    const errors = vi.fn();
    const runner = service(protocol, passingExecutor(), spool, errors);
    const stop = setTimeout(() => runner.stop(), 25);

    await runner.run();
    clearTimeout(stop);

    expect(errors).toHaveBeenCalled();
    expect(spool.pending()).toBe(0);
  });

  it('keeps unacknowledged events queued when the API reports a non-terminal conflict', async () => {
    const spool = new MemorySpool();
    const protocol = new FakeProtocol();
    protocol.conflict = true;
    protocol.enqueue(claim());
    const errors = vi.fn();
    const runner = service(protocol, passingExecutor(), spool, errors, { sleep: immediateSleep });
    const stop = setTimeout(() => runner.stop(), 20);

    await runner.run();
    clearTimeout(stop);

    expect(errors).toHaveBeenCalled();
    expect(protocol.events.length).toBeGreaterThan(0);
    expect(protocol.events[0]?.sequence).toBe(1);
    expect(Math.max(...protocol.events.map((event) => event.sequence))).toBe(5);
    expect(protocol.events.at(-1)?.sequence).toBe(5);
    expect(spool.pending()).toBe(6);
    expect(protocol.completions).toEqual([]);
  });
});

const RETRY_BUDGET: SpoolRetryPolicy = { maxAttempts: 8, baseDelayMs: 100, maxDelayMs: 1_000 };

/**
 * `baseDelayMs * 2 ** (attempt - 1)` clamped at `maxDelayMs`, for the seven
 * attempts that schedule a backoff. The eighth is the one that dead-letters, so
 * it schedules nothing.
 */
const RETRY_CEILINGS = [100, 200, 400, 800, 1_000, 1_000, 1_000];

function passingExecutor(): FakeExecutor {
  return new FakeExecutor(async () => ({
    status: 'passed',
    resultPath: '',
    workspacePath: '',
    artifacts: [],
    stdout: '',
    stderr: '',
  }));
}

class FailFirstAckSpool extends MemorySpool {
  ackFailures = 1;

  override async ack(ids: readonly string[]): Promise<void> {
    if (this.ackFailures > 0) {
      this.ackFailures -= 1;
      throw new Error('spool acknowledgement failed');
    }
    await super.ack(ids);
  }
}

function stuckEvent(id: string, jobId: string): SpoolEntry {
  return {
    id,
    jobId,
    kind: 'event',
    sequence: 1,
    leaseId: `lease-${jobId}`,
    fencingToken: 1,
    payload: { note: 'never delivered', jobId },
  };
}

interface Exhausted {
  delays: number[];
  deliverCalls: number;
  spool: DurableSpool;
  errors: string[];
}

/**
 * Runs a real durable spool against an API that is permanently unreachable until
 * the entry is dead-lettered, and returns the backoff delays the service asked
 * for. The delays come from the injected sleep seam, so the retry schedule is an
 * exact list rather than something inferred from elapsed time.
 */
async function exhaustRetryBudget(random: () => number): Promise<Exhausted> {
  const root = await mkdtemp(join(tmpdir(), 'runner-spool-retry-'));
  roots.push(root);
  const spool = await DurableSpool.open({ directory: root, key: 'stable-runner-key' });
  await spool.enqueue(stuckEvent('stuck-event', 'job-stuck'));
  const protocol = new FakeProtocol();
  protocol.alwaysFail = new Error('runner API is unreachable');
  const delays: number[] = [];
  const errors: string[] = [];
  const runner = service(
    protocol,
    passingExecutor(),
    spool,
    (error: unknown) => {
      errors.push(error instanceof Error ? error.message : String(error));
    },
    {
      retryPolicy: RETRY_BUDGET,
      random,
      sleep: (milliseconds) => {
        delays.push(milliseconds);
        return Promise.resolve();
      },
    },
  );

  const running = runner.run();
  await until('entry is dead-lettered', async () => (await spool.deadLetters()).length === 1);
  runner.stop();
  await running;

  return { delays, deliverCalls: protocol.deliverCalls, spool, errors };
}

describe('RunnerService spool retry budget', () => {
  it('stops retrying an unreachable API, dead-letters the entry, and keeps it readable after a restart', async () => {
    const root = await mkdtemp(join(tmpdir(), 'runner-spool-retry-'));
    roots.push(root);
    const spool = await DurableSpool.open({ directory: root, key: 'stable-runner-key' });
    await spool.enqueue(stuckEvent('stuck-event', 'job-stuck'));
    const unreachable = new FakeProtocol();
    unreachable.alwaysFail = new Error('runner API is unreachable');
    const errors: string[] = [];
    const runner = service(
      unreachable,
      passingExecutor(),
      spool,
      (error: unknown) => {
        errors.push(error instanceof Error ? error.message : String(error));
      },
      { retryPolicy: RETRY_BUDGET, random: () => 0.5, sleep: immediateSleep },
    );

    const running = runner.run();
    await until(
      'entry is dead-lettered and reported',
      async () =>
        (await spool.deadLetters()).length === 1 &&
        errors.some((message) => message.startsWith('Runner spool entry dead-lettered')),
    );
    runner.stop();
    await running;

    expect(unreachable.deliverCalls).toBe(RETRY_BUDGET.maxAttempts);
    expect(errors).toContain(
      `Runner spool entry dead-lettered after ${String(RETRY_BUDGET.maxAttempts)} attempts (Error)`,
    );

    const restarted = await DurableSpool.open({ directory: root, key: 'stable-runner-key' });
    const letters = await restarted.deadLetters();
    expect(letters).toHaveLength(1);
    expect(letters[0]).toMatchObject({
      id: 'stuck-event',
      jobId: 'job-stuck',
      disposition: 'dead_letter',
      attempts: RETRY_BUDGET.maxAttempts,
      lastError: 'Error',
      payload: { note: 'never delivered', jobId: 'job-stuck' },
    });
    expect(await restarted.peek()).toEqual([]);
    expect(restarted.pending()).toBe(1);

    const recovered = new FakeProtocol();
    recovered.enqueue(claim('job-after-restart'));
    const afterRestart = service(recovered, passingExecutor(), restarted, vi.fn(), {
      retryPolicy: RETRY_BUDGET,
      random: () => 0.5,
      sleep: immediateSleep,
    });
    recovered.onComplete = () => afterRestart.stop();

    await afterRestart.run();

    expect(recovered.completions).toHaveLength(1);
    expect(recovered.events.length).toBeGreaterThan(0);
    expect(new Set(recovered.events.map((event) => event.runId))).toEqual(
      new Set(['run-job-after-restart']),
    );
    expect(await restarted.deadLetters()).toHaveLength(1);
    expect(restarted.pending()).toBe(1);
  });

  it('grows the retry delay from the base delay and pins it at the maximum delay', async () => {
    const { delays, deliverCalls } = await exhaustRetryBudget(() => 1);

    expect(deliverCalls).toBe(RETRY_BUDGET.maxAttempts);
    expect(delays).toEqual(RETRY_CEILINGS);
    expect(delays.slice(0, 4)).toEqual([100, 200, 400, 800]);
    expect(delays.slice(4)).toEqual([1_000, 1_000, 1_000]);
    expect(Math.max(...delays)).toBe(RETRY_BUDGET.maxDelayMs);
    for (let index = 1; index < delays.length; index += 1) {
      expect(delays[index]).toBeGreaterThanOrEqual(delays[index - 1]);
    }
  });

  it('backs off instead of retrying immediately when the spool cannot acknowledge', async () => {
    const spool = new FailFirstAckSpool();
    const protocol = new FakeProtocol();
    const errors: string[] = [];
    const delays: number[] = [];
    const runner = service(
      protocol,
      passingExecutor(),
      spool,
      (error: unknown) => {
        errors.push(error instanceof Error ? error.message : String(error));
      },
      {
        retryPolicy: { maxAttempts: 4, baseDelayMs: 100, maxDelayMs: 1_000 },
        random: () => 1,
        sleep: (milliseconds) => {
          delays.push(milliseconds);
          return Promise.resolve();
        },
      },
    );
    await spool.enqueue(stuckEvent('stuck-event', 'job-ack'));
    protocol.onComplete = () => runner.stop();

    const running = runner.run();
    await until('spool drains', () => spool.pending() === 0);
    runner.stop();
    await running;

    expect(errors).toContain('spool acknowledgement failed');
    expect(delays[0]).toBe(100);
    expect(await spool.deadLetters()).toEqual([]);
  });

  it('keeps jitter present and bounded so a fleet does not retry in lockstep', async () => {
    const floor = await exhaustRetryBudget(() => 0);
    const ceiling = await exhaustRetryBudget(() => 1);
    const jittered = await exhaustRetryBudget(
      (() => {
        const draws = [0, 0.5, 1];
        let index = 0;
        return () => draws[index++ % draws.length]!;
      })(),
    );

    expect(floor.delays).toEqual(RETRY_CEILINGS.map((value) => value / 2));
    expect(ceiling.delays).toEqual(RETRY_CEILINGS);
    expect(jittered.delays).toEqual([50, 150, 400, 400, 750, 1_000, 500]);
    expect(floor.delays).not.toEqual(ceiling.delays);
    expect(new Set(jittered.delays).size).toBeGreaterThan(1);
    for (const delays of [floor.delays, jittered.delays, ceiling.delays]) {
      expect(delays).toHaveLength(RETRY_BUDGET.maxAttempts - 1);
    }
  });
});
