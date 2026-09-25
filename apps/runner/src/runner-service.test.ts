import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  RunnerConfigurationError,
  type ExecutionContext,
  type ExecutionProvider,
  type ExecutionResult,
} from './execution.js';
import type {
  ArtifactDescriptor,
  ExecutionEventInput,
  JobClaim,
  JobCompletion,
  RunnerHeartbeat,
} from './protocol.js';
import { RunnerService, type RunnerProtocol } from './runner-service.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
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
    this.events.push(...events);
    return {
      results: events.map((event) => ({
        eventId: event.eventId,
        sequence: event.sequence,
        status: 'accepted',
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
    this.completions.push(completion);
    return {};
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

function service(protocol: RunnerProtocol, executor: ExecutionProvider): RunnerService {
  return new RunnerService({
    runnerId: 'runner-1',
    capabilities: ['playwright', 'chromium'],
    labels: ['trusted'],
    slots: 1,
    pollIntervalMs: 1,
    heartbeatIntervalMs: 60_000,
    protocol,
    executor,
    onError: vi.fn(),
  });
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
