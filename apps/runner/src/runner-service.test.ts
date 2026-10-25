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
  RunnerApiError,
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
 * Yields to the event loop until a condition the service controls holds.
 *
 * Bounded by **elapsed time** rather than by iteration count. It used to be 150
 * iterations with a 1 ms yield between them, which reads like 150 ms and is not: each
 * iteration performs real asynchronous filesystem work against a `DurableSpool`, so on
 * a loaded machine 150 iterations of that can take far longer than 150 ms of wall clock
 * — and far less than enough. This test, `stops retrying an unreachable API,
 * dead-letters the entry, and keeps it readable after a restart`, failed one run in
 * three under `pnpm test`, passed in isolation every time, and was not reproducible by
 * any change to the runner. An iteration bound is a load-sensitive deadline wearing the
 * costume of a fixed one, and the same mistake as E-6 on the client side: `testTimeout`
 * was raised for a documented reason while the inner clock the assertions actually race
 * was left at a value chosen when the machine was idle.
 *
 * The property worth keeping from the original is the failure: a labelled error naming
 * which condition never held, not a bare vitest timeout with no indication of what the
 * service was doing. Time-bounding does that just as well, and 5 s is generous for
 * conditions that settle in milliseconds while still failing the suite in seconds if the
 * service is genuinely stuck.
 *
 * @param label what the condition is, quoted in the failure
 * @param predicate the condition, re-evaluated on every tick
 * @param budgetMs how long to keep trying before giving up
 */
async function until(
  label: string,
  predicate: () => boolean | Promise<boolean>,
  budgetMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + budgetMs;
  do {
    if (await predicate()) return;
    await new Promise((resolveTick) => setTimeout(resolveTick, 1));
  } while (Date.now() < deadline);
  throw new Error(`Condition never held after ${String(budgetMs)}ms: ${label}`);
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

  it('hands the executor the API collection and environment the job names', async () => {
    const protocol = new FakeProtocol();
    protocol.enqueue({
      ...claim('job-api'),
      spec: {
        configuration: {
          apiCollection: 'pass',
          apiEnvironment: 'local',
          targetUrl: 'https://allowed.test',
        },
      },
    });
    const seen: Array<Partial<ExecutionContext>> = [];
    const executor = new FakeExecutor(async (context) => {
      seen.push({
        apiCollection: context.apiCollection,
        apiEnvironment: context.apiEnvironment,
        playwrightProject: context.playwrightProject,
        targetUrl: context.targetUrl,
      });
      return {
        status: 'passed',
        resultPath: '',
        workspacePath: '',
        artifacts: [],
        stdout: '',
        stderr: '',
      };
    });
    const runner = service(protocol, executor);
    const stop = setTimeout(() => runner.stop(), 10);

    await runner.run();
    clearTimeout(stop);

    expect(seen).toEqual([
      {
        apiCollection: 'pass',
        apiEnvironment: 'local',
        playwrightProject: undefined,
        targetUrl: 'https://allowed.test',
      },
    ]);
  });
  it('clones a git-sourced job, runs the command in the clone, redacts the token, and removes the clone', async () => {
    const protocol = new FakeProtocol();
    const checkoutCalls: string[] = [];
    Object.assign(protocol, {
      checkout: async (jobId: string) => {
        checkoutCalls.push(jobId);
        return { url: 'https://github.com/a/b.git', token: 'tok-xyz' };
      },
    });
    protocol.enqueue({
      ...claim('job-clone'),
      spec: {
        configuration: {
          command: {
            argv: ['gitleaks', 'dir', '.'],
            workingDirectory: '.',
            artifactGlobs: ['out.sarif'],
            evidence: 'artifact',
          },
          checkout: { url: 'https://github.com/a/b.git' },
          health: { branch: 'main' },
        },
      },
    });
    const seen: Array<{ repository: unknown; redactions: string[] | undefined }> = [];
    const executor = new FakeExecutor(async (context) => {
      seen.push({
        repository: (context.command as { repository?: unknown }).repository,
        redactions: context.redactions,
      });
      return {
        status: 'passed',
        resultPath: '',
        workspacePath: '',
        artifacts: [],
        stdout: '',
        stderr: '',
      };
    });
    const removed: string[] = [];
    const runner = new RunnerService({
      runnerId: 'runner-1',
      capabilities: ['gitleaks'],
      labels: [],
      slots: 1,
      pollIntervalMs: 1,
      heartbeatIntervalMs: 60_000,
      protocol,
      executor,
      spool: new MemorySpool(),
      onError: vi.fn(),
      checkout: {
        clone: async (request) => {
          expect(request).toMatchObject({
            url: 'https://github.com/a/b.git',
            token: 'tok-xyz',
            branch: 'main',
          });
          return '/repos/.automate-checkouts/job-clone';
        },
        remove: async (path) => {
          removed.push(path);
        },
      },
    });
    const stop = setTimeout(() => runner.stop(), 20);
    await runner.run();
    clearTimeout(stop);
    expect(checkoutCalls).toEqual(['job-clone']);
    expect(seen[0]?.repository).toBe('/repos/.automate-checkouts/job-clone');
    expect(seen[0]?.redactions).toContain('tok-xyz');
    expect(removed).toEqual(['/repos/.automate-checkouts/job-clone']);
  });

  it('fails a clone job on a runner that cannot clone, without running anything', async () => {
    const protocol = new FakeProtocol();
    protocol.enqueue({
      ...claim('job-noclone'),
      spec: {
        configuration: {
          command: { argv: ['gitleaks'], workingDirectory: '.', artifactGlobs: [] },
          checkout: { url: 'https://github.com/a/b.git' },
        },
      },
    });
    const executor = new FakeExecutor(async () => {
      throw new Error('must not run');
    });
    const runner = service(protocol, executor);
    const stop = setTimeout(() => runner.stop(), 20);
    await runner.run();
    clearTimeout(stop);
    expect(protocol.completions[0]?.error?.message).toMatch(/does not clone/u);
  });

  it("gives the executor the job's own timeout, not the lease left at claim time", async () => {
    // The lease is 30 s by default and every heartbeat renews it, so it says how long
    // the runner may go *silent*, not how long a suite may run. Capping the deadline at
    // the lease left when the job was claimed ended every suite longer than about 30 s
    // as `timed_out`, with a healthy lease and a 30-minute timeout nowhere near.
    const protocol = new FakeProtocol();
    const shortLease = {
      ...claim('job-long'),
      timeoutMs: 600_000,
      leaseExpiresAt: new Date(Date.now() + 1_000).toISOString(),
    };
    protocol.enqueue(shortLease);
    const deadlines: number[] = [];
    const executor = new FakeExecutor(async (context) => {
      deadlines.push(context.deadlineMs);
      return {
        status: 'passed',
        resultPath: '',
        workspacePath: '',
        artifacts: [],
        stdout: '',
        stderr: '',
      };
    });
    const runner = service(protocol, executor);
    const stop = setTimeout(() => runner.stop(), 10);

    await runner.run();
    clearTimeout(stop);

    expect(deadlines).toEqual([600_000]);
  });

  it("hands a load job's k6 block to the executor and no Playwright project", async () => {
    const protocol = new FakeProtocol();
    const k6 = { script: 'smoke.js', vus: 2, durationSeconds: 5 };
    protocol.enqueue({
      ...claim('job-load'),
      spec: { configuration: { k6, targetUrl: 'https://allowed.test' } },
    });
    const seen: Array<Pick<ExecutionContext, 'k6' | 'playwrightProject' | 'targetUrl'>> = [];
    const executor = new FakeExecutor(async (context) => {
      seen.push({
        k6: context.k6,
        playwrightProject: context.playwrightProject,
        targetUrl: context.targetUrl,
      });
      return {
        status: 'passed',
        resultPath: '',
        workspacePath: '',
        artifacts: [],
        stdout: '',
        stderr: '',
      };
    });
    const runner = service(protocol, executor);
    const stop = setTimeout(() => runner.stop(), 10);

    await runner.run();
    clearTimeout(stop);

    expect(seen).toEqual([{ k6, playwrightProject: undefined, targetUrl: 'https://allowed.test' }]);
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

function emptyResult(status: ExecutionResult['status'] = 'passed'): ExecutionResult {
  return { status, resultPath: '', workspacePath: '', artifacts: [], stdout: '', stderr: '' };
}

/** A service whose run ends when the first completion is delivered. */
async function runToCompletion(
  protocol: FakeProtocol,
  executor: ExecutionProvider,
  overrides: Partial<RunnerServiceOptions> = {},
): Promise<RunnerService> {
  const runner = new RunnerService({
    runnerId: 'runner-1',
    capabilities: ['playwright'],
    labels: [],
    slots: 1,
    pollIntervalMs: 1,
    heartbeatIntervalMs: 60_000,
    protocol,
    executor,
    spool: new MemorySpool(),
    onError: vi.fn(),
    sleep: immediateSleep,
    ...overrides,
  });
  protocol.onComplete = () => runner.stop();
  await runner.run();
  return runner;
}

describe('RunnerService reporter event translation', () => {
  it('maps Playwright reporter events onto canonical test events and drops the rest', async () => {
    const protocol = new FakeProtocol();
    protocol.enqueue(claim());
    const occurredAt = new Date().toISOString();
    const reporter = (eventId: string, type: string, payload: Record<string, unknown>) => ({
      eventId,
      sequence: 1,
      type,
      occurredAt,
      payload,
    });
    const executor = new FakeExecutor(async (context) => {
      const emit = context.onEvent;
      if (!emit) throw new Error('the service must subscribe to reporter events');
      await emit(
        reporter('r-1', 'test.started', { testId: 't-1', title: 'logs in', file: 'a.spec.ts' }),
      );
      await emit(
        reporter('r-2', 'test.completed', {
          testId: 't-1',
          status: 'timedOut',
          durationMs: 31_000,
          attempt: 2,
          errors: [{ message: 'Timeout 30000ms exceeded' }],
        }),
      );
      await emit(reporter('r-3', 'test.completed', { testId: 't-2', status: 'interrupted' }));
      await emit(reporter('r-4', 'test.completed', { testId: 't-3', status: 'flaky' }));
      await emit(reporter('r-5', 'test.completed', { testId: 't-4', status: 'bogus' }));
      await emit(reporter('r-6', 'test.completed', { status: 'failed', errors: 'not a list' }));
      await emit(reporter('r-7', 'run.progress', { status: 'passed' }));
      return emptyResult();
    });

    await runToCompletion(protocol, executor);

    const tests = protocol.events.filter((event) => event.type.startsWith('test.'));
    expect(tests.map((event) => [event.type, event.payload])).toEqual([
      [
        'test.started',
        expect.objectContaining({
          testId: 't-1',
          attempt: 1,
          status: 'running',
          title: 'logs in',
          file: 'a.spec.ts',
          startedAt: occurredAt,
        }),
      ],
      [
        'test.completed',
        expect.objectContaining({
          testId: 't-1',
          attempt: 2,
          status: 'timed_out',
          durationMs: 31_000,
          finishedAt: occurredAt,
          error: { code: 'PLAYWRIGHT_TEST_FAILED', message: 'Timeout 30000ms exceeded' },
        }),
      ],
      ['test.completed', expect.objectContaining({ testId: 't-2', status: 'cancelled' })],
      ['test.completed', expect.objectContaining({ testId: 't-3', status: 'flaky', error: null })],
      ['test.completed', expect.objectContaining({ testId: 't-4', status: 'unknown' })],
      [
        'test.completed',
        expect.objectContaining({
          // No testId in the reporter payload: the reporter's event id stands in for it.
          testId: 'r-6',
          status: 'failed',
          durationMs: 0,
          error: { code: 'PLAYWRIGHT_TEST_FAILED', message: 'Playwright test failed' },
        }),
      ],
    ]);
    expect(protocol.events.some((event) => JSON.stringify(event).includes('r-7'))).toBe(false);
  });

  it('records the branch and commit of the job on run.started, and maps succeeded to passed', async () => {
    const protocol = new FakeProtocol();
    protocol.enqueue({ ...claim(), spec: { ...claim().spec, branch: 'main', commit: 'abc123' } });

    await runToCompletion(protocol, new FakeExecutor(async () => emptyResult('succeeded')));

    const started = protocol.events.find((event) => event.type === 'run.started');
    expect(started?.payload).toMatchObject({ branch: 'main', commit: 'abc123', phase: 'running' });
    expect(protocol.completions[0]).toMatchObject({ status: 'passed', phase: 'complete' });
  });
});

describe('RunnerService failure classification', () => {
  it('completes an executor crash as an infrastructure failure carrying its message', async () => {
    const protocol = new FakeProtocol();
    protocol.enqueue(claim());

    await runToCompletion(
      protocol,
      new FakeExecutor(() => Promise.reject(new Error('browser binary is missing'))),
    );

    expect(protocol.completions[0]).toMatchObject({
      status: 'infra_failed',
      phase: 'infra_failed',
      error: { code: 'RUNNER_INFRA_FAILED', message: 'browser binary is missing' },
    });
    const completed = protocol.events.find((event) => event.type === 'run.completed');
    expect(completed?.payload).toMatchObject({ phase: 'infra_failed', artifactIds: [] });
  });

  it('uses a generic message when the executor rejects with something that is not an Error', async () => {
    const protocol = new FakeProtocol();
    protocol.enqueue(claim());
    const executor: ExecutionProvider = {
      execute: () => Promise.reject(new Map([['not', 'an error']])),
    };

    await runToCompletion(protocol, executor);

    expect(protocol.completions[0]?.error).toEqual({
      code: 'RUNNER_INFRA_FAILED',
      message: 'Runner execution failed',
    });
  });

  it('refuses a malformed generic command as a configuration failure without executing it', async () => {
    const protocol = new FakeProtocol();
    protocol.enqueue({ ...claim(), spec: { configuration: { command: 'rm -rf /' } } });
    const execute = vi.fn(async () => emptyResult());

    await runToCompletion(protocol, { execute });

    expect(execute).not.toHaveBeenCalled();
    expect(protocol.completions[0]).toMatchObject({
      status: 'config_failed',
      error: { code: 'CONFIG_FAILED', message: 'Job command must be an object' },
    });
  });

  it('reports a failed workspace cleanup without losing the completion', async () => {
    const protocol = new FakeProtocol();
    protocol.enqueue(claim());
    const errors = vi.fn();
    const executor: ExecutionProvider = {
      execute: async () => ({ ...emptyResult(), workspacePath: '/workspace/job-1' }),
      cleanup: () => Promise.reject(new Error('workspace is locked')),
    };

    await runToCompletion(protocol, executor, { onError: errors });

    expect(protocol.completions).toHaveLength(1);
    expect(errors).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'workspace is locked' }),
    );
  });
});

class CancellingProtocol extends FakeProtocol {
  readonly heartbeats: Array<Parameters<RunnerProtocol['heartbeat']>[0]> = [];

  override async heartbeat(
    request?: Parameters<RunnerProtocol['heartbeat']>[0],
  ): Promise<RunnerHeartbeat> {
    if (request) this.heartbeats.push(request);
    const base = await super.heartbeat();
    return { ...base, cancelRequestedJobIds: request?.activeJobs ?? [] };
  }
}

class FlakyClaimProtocol extends FakeProtocol {
  claimFailure: unknown = new Error('claim endpoint is down');

  override async claim(): Promise<JobClaim | null> {
    const failure = this.claimFailure;
    if (failure !== undefined) {
      this.claimFailure = undefined;
      throw failure;
    }
    return super.claim();
  }
}

describe('RunnerService lifecycle', () => {
  it('cancels a running job the heartbeat reports as cancel-requested', async () => {
    const protocol = new CancellingProtocol();
    protocol.enqueue(claim());
    const executor = new FakeExecutor(async (context) => {
      if (!context.signal.aborted) {
        await new Promise<void>((resolveAbort) => {
          context.signal.addEventListener('abort', () => resolveAbort(), { once: true });
        });
      }
      return emptyResult('cancelled');
    });

    await runToCompletion(protocol, executor, { heartbeatIntervalMs: 0 });

    expect(protocol.completions[0]).toMatchObject({ status: 'cancelled', phase: 'cancelled' });
    expect(protocol.heartbeats).toContainEqual({
      leaseId: 'lease-job-1',
      activeJobs: ['job-1'],
      metrics: { activeJobs: 1, slots: 1 },
    });
  });

  it('is not ready after a failed poll, recovers on the next one, and is not ready once stopped', async () => {
    const protocol = new FlakyClaimProtocol();
    const errors: unknown[] = [];
    let readyAfterFailure: boolean | undefined;
    const runner = new RunnerService({
      runnerId: 'runner-1',
      capabilities: [],
      labels: [],
      slots: 1,
      pollIntervalMs: 1,
      heartbeatIntervalMs: 60_000,
      protocol,
      executor: passingExecutor(),
      spool: new MemorySpool(),
      onError: (error) => {
        errors.push(error);
        readyAfterFailure = runner.isReady();
      },
    });
    expect(runner.isReady()).toBe(false);

    const running = runner.run();
    await until('runner recovers', () => runner.isReady());
    runner.stop();
    await running;

    expect(errors).toEqual([expect.objectContaining({ message: 'claim endpoint is down' })]);
    expect(readyAfterFailure).toBe(false);
    expect(runner.isReady()).toBe(false);
    expect(runner.cancel('no-such-job')).toBe(false);
    expect(runner.activeJobIds()).toEqual([]);
  });

  it('logs an unhandled failure by name only when no error handler is supplied', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      for (const [failure, name] of [
        [new TypeError('secret detail'), 'TypeError'],
        ['a bare string', 'RUNNER_ERROR'],
      ] as const) {
        const protocol = new FlakyClaimProtocol();
        protocol.claimFailure = failure;
        const runner = new RunnerService({
          runnerId: 'runner-1',
          capabilities: [],
          labels: [],
          slots: 1,
          pollIntervalMs: 1,
          heartbeatIntervalMs: 60_000,
          protocol,
          executor: passingExecutor(),
          spool: new MemorySpool(),
        });
        const running = runner.run();
        await until('the failure is logged', () =>
          logged.mock.calls.some((call) => call[0] === `runner job failed (${name})`),
        );
        runner.stop();
        await running;
      }
      expect(logged.mock.calls.flat().join('\n')).not.toContain('secret detail');
    } finally {
      logged.mockRestore();
    }
  });

  it('does not poll at all when the external signal is already aborted', async () => {
    const protocol = new FakeProtocol();
    const claimSpy = vi.spyOn(protocol, 'claim');
    const runner = service(protocol, passingExecutor());
    const controller = new AbortController();
    controller.abort();

    await runner.run(controller.signal);

    expect(claimSpy).not.toHaveBeenCalled();
  });

  it('stops when the external signal aborts mid-run', async () => {
    const protocol = new FakeProtocol();
    const controller = new AbortController();
    const runner = new RunnerService({
      runnerId: 'runner-1',
      capabilities: [],
      labels: [],
      slots: 1,
      // Long enough that only the abort can end the wait between polls.
      pollIntervalMs: 60_000,
      heartbeatIntervalMs: 60_000,
      protocol,
      executor: passingExecutor(),
      spool: new MemorySpool(),
      onError: vi.fn(),
    });

    const running = runner.run(controller.signal);
    await until('first poll completes', () => runner.isReady());
    controller.abort();

    await expect(running).resolves.toBeUndefined();
    expect(runner.isReady()).toBe(false);
  });
});

class RejectingCompletionProtocol extends FakeProtocol {
  completionAttempts = 0;

  constructor(private readonly failure: Error) {
    super();
  }

  override async complete(): Promise<unknown> {
    this.completionAttempts += 1;
    throw this.failure;
  }
}

describe('RunnerService delivery conflicts', () => {
  it.each(['terminal_event', 'event_hash_mismatch', 'run_not_found'])(
    'drops events the API permanently rejects as %s instead of retrying them',
    async (status) => {
      const spool = new MemorySpool();
      const protocol = new FakeProtocol();
      protocol.conflict = true;
      protocol.conflictStatus = status;
      protocol.enqueue(claim());
      const errors: string[] = [];

      await runToCompletion(protocol, passingExecutor(), {
        spool,
        onError: (error) => errors.push(error instanceof Error ? error.message : String(error)),
      });

      expect(errors).toContain(`Runner spool entry permanently rejected (${status})`);
      expect(protocol.completions).toHaveLength(1);
      expect(spool.pending()).toBe(0);
    },
  );

  it('keeps events queued on a sequence gap, which a later delivery can still fill', async () => {
    const spool = new MemorySpool();
    const protocol = new FakeProtocol();
    protocol.conflict = true;
    protocol.conflictStatus = 'sequence_gap';
    protocol.enqueue(claim());
    const errors: string[] = [];
    const runner = service(
      protocol,
      passingExecutor(),
      spool,
      (error) => errors.push(error instanceof Error ? error.message : String(error)),
      { sleep: immediateSleep },
    );

    const running = runner.run();
    await until('the conflict is reported', () =>
      errors.includes('Runner spool entries are not acknowledged and stay queued'),
    );
    runner.stop();
    await running;

    expect(spool.pending()).toBeGreaterThan(0);
    expect(errors.some((message) => message.includes('permanently rejected'))).toBe(false);
  });

  it.each([
    { name: 'a 409', failure: new RunnerApiError(409, 'conflict') },
    { name: 'a stale_lease code', failure: new RunnerApiError(410, 'stale_lease') },
  ])('drops a completion the API refuses with $name as a stale lease', async ({ failure }) => {
    const spool = new MemorySpool();
    const protocol = new RejectingCompletionProtocol(failure);
    protocol.enqueue(claim());
    const errors: string[] = [];
    const runner = service(
      protocol,
      passingExecutor(),
      spool,
      (error) => errors.push(error instanceof Error ? error.message : String(error)),
      { sleep: immediateSleep },
    );

    const running = runner.run();
    await until('the completion is dropped', () =>
      errors.includes('Runner spool entry permanently rejected (stale_lease)'),
    );
    runner.stop();
    await running;

    expect(protocol.completionAttempts).toBe(1);
    expect(spool.pending()).toBe(0);
  });

  it('retries a completion rejected for any other reason', async () => {
    const protocol = new RejectingCompletionProtocol(new RunnerApiError(503, 'unavailable'));
    protocol.enqueue(claim());
    const runner = service(protocol, passingExecutor(), new MemorySpool(), vi.fn(), {
      sleep: immediateSleep,
    });

    const running = runner.run();
    await until('the completion is retried', () => protocol.completionAttempts >= 2);
    runner.stop();
    await running;

    expect(protocol.completionAttempts).toBeGreaterThanOrEqual(2);
  });

  it('waits on the real clock between retries when no sleep seam is injected', async () => {
    const protocol = new FakeProtocol();
    protocol.failures = 2;
    protocol.enqueue(claim());
    const errors: string[] = [];

    await runToCompletion(protocol, passingExecutor(), {
      sleep: undefined,
      retryPolicy: { maxAttempts: 5, baseDelayMs: 1, maxDelayMs: 2 },
      onError: (error) => errors.push(error instanceof Error ? error.message : String(error)),
    });

    expect(errors.filter((message) => message === 'runner API is unreachable')).toHaveLength(2);
    expect(protocol.completions).toHaveLength(1);
  });
});
