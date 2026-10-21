import { afterEach, describe, expect, it, vi } from 'vitest';
import { InMemoryExecutionStore, type SeedJob } from './in-memory-store.js';
import type { JobHandler, JobResultStatus } from './types.js';
import { ExecutionWorker, type ExecutionWorkerOptions } from './worker.js';

/**
 * How a claimed job ends, and how the poll loop behaves when the store does not
 * answer. `worker.test.ts` covers the happy path and the no-handler invariant; these
 * are the outcomes a handler does not choose for itself — timeout, lost lease,
 * a thrown handler, a requeue — and what each one writes back.
 */

afterEach(() => {
  vi.restoreAllMocks();
});

function waitForAbort(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) resolve();
    else signal.addEventListener('abort', () => resolve(), { once: true });
  });
}

function setup(
  handler: JobHandler,
  overrides: Partial<ExecutionWorkerOptions> = {},
  job: Partial<SeedJob> = {},
): { store: InMemoryExecutionStore; worker: ExecutionWorker } {
  const store = new InMemoryExecutionStore({ leaseDurationMs: 60_000 });
  store.addRunner({ id: 'runner', capabilities: ['playwright'], slots: 4 });
  store.addJob({
    id: 'job-1',
    runId: 'run-1',
    workspaceId: 'workspace-1',
    requiredCapabilities: ['playwright'],
    ...job,
  });
  const worker = new ExecutionWorker({
    store,
    runnerId: 'runner',
    capabilities: [],
    labels: [],
    slots: 1,
    pollIntervalMs: 1,
    leaseDurationMs: 60_000,
    leaseRenewIntervalMs: 60_000,
    handler,
    ...overrides,
  });
  return { store, worker };
}

async function drained(worker: ExecutionWorker): Promise<void> {
  await vi.waitFor(() => expect(worker.activeJobIds()).toEqual([]));
}

describe('a claimed job ends as', () => {
  it('failed, with the status as the error code, when the handler says so', async () => {
    const { store, worker } = setup({ execute: () => Promise.resolve('failed') });
    const complete = vi.spyOn(store, 'completeJob');

    const { claimed } = await worker.runOnce();
    await drained(worker);

    expect(claimed.map((claim) => claim.jobId)).toEqual(['job-1']);
    expect(complete).toHaveBeenCalledWith('job-1', {
      leaseId: claimed[0]?.leaseId,
      fencingToken: 1,
      status: 'failed',
      error: { code: 'FAILED', message: 'Job ended as failed' },
    });
    expect(store.getJob('job-1')).toMatchObject({
      state: 'failed',
      error: { code: 'FAILED', message: 'Job ended as failed' },
    });
  });

  it('infra_failed when the handler throws', async () => {
    const { store, worker } = setup({
      execute: () => Promise.reject(new Error('runner binary missing')),
    });
    const complete = vi.spyOn(store, 'completeJob');

    await worker.runOnce();
    await drained(worker);

    expect(complete.mock.calls[0]?.[1]).toMatchObject({
      status: 'infra_failed',
      error: { code: 'WORKER_INFRA_FAILED', message: 'Job handler failed' },
    });
    expect(store.getJob('job-1')?.state).toBe('failed');
  });

  it('timed_out when the job outlives its timeout, whatever the handler returns', async () => {
    const { store, worker } = setup(
      {
        execute: async (_claim, signal) => {
          await waitForAbort(signal);
          return 'completed';
        },
      },
      {},
      { timeoutMs: 10 },
    );
    const complete = vi.spyOn(store, 'completeJob');

    await worker.runOnce();
    await drained(worker);

    expect(complete.mock.calls[0]?.[1]).toMatchObject({
      status: 'timed_out',
      error: { code: 'TIMED_OUT', message: 'Job ended as timed_out' },
    });
  });

  it('timed_out, not infra_failed, when the handler throws after the timeout', async () => {
    const { store, worker } = setup(
      {
        execute: async (_claim, signal) => {
          await waitForAbort(signal);
          throw new Error('aborted');
        },
      },
      {},
      { timeoutMs: 10 },
    );
    const complete = vi.spyOn(store, 'completeJob');

    await worker.runOnce();
    await drained(worker);

    expect(complete.mock.calls[0]?.[1]).toMatchObject({
      status: 'timed_out',
      error: { code: 'WORKER_INFRA_FAILED' },
    });
  });

  it('runner_lost when a renewal is refused, and the handler is aborted', async () => {
    let aborted = false;
    const { store, worker } = setup(
      {
        execute: async (_claim, signal) => {
          await waitForAbort(signal);
          aborted = true;
          return 'completed';
        },
      },
      { leaseRenewIntervalMs: 5 },
    );
    const renew = vi.spyOn(store, 'renewLease').mockResolvedValue(false);
    const complete = vi.spyOn(store, 'completeJob');

    await worker.runOnce();
    await drained(worker);

    expect(aborted).toBe(true);
    expect(renew).toHaveBeenCalledWith('job-1', expect.any(String), 1, expect.any(Date));
    expect(complete.mock.calls[0]?.[1]).toMatchObject({
      status: 'runner_lost',
      error: { code: 'RUNNER_LOST' },
    });
  });

  it('runner_lost when the handler throws after the lease was lost', async () => {
    const { store, worker } = setup(
      {
        execute: async (_claim, signal) => {
          await waitForAbort(signal);
          throw new Error('aborted');
        },
      },
      { leaseRenewIntervalMs: 5 },
    );
    vi.spyOn(store, 'renewLease').mockResolvedValue(false);
    const complete = vi.spyOn(store, 'completeJob');

    await worker.runOnce();
    await drained(worker);

    expect(complete.mock.calls[0]?.[1]).toMatchObject({
      status: 'runner_lost',
      error: { code: 'WORKER_INFRA_FAILED' },
    });
  });

  it('back on the queue, through releaseJob, when the handler asks for a requeue', async () => {
    const { store, worker } = setup({ execute: () => Promise.resolve('requeue') });
    const complete = vi.spyOn(store, 'completeJob');
    const release = vi.spyOn(store, 'releaseJob');

    await worker.runOnce();
    await drained(worker);

    expect(release).toHaveBeenCalledWith('job-1', expect.any(String), 1);
    expect(complete).not.toHaveBeenCalled();
    expect(store.getJob('job-1')).toMatchObject({ state: 'queued', leaseId: null });
  });
});

describe('lease renewal while a job runs', () => {
  it('reports a renewal that throws and lets the job finish', async () => {
    let reported: unknown;
    let onReported: () => void = () => undefined;
    const reportedOnce = new Promise<void>((resolve) => {
      onReported = resolve;
    });
    const { store, worker } = setup(
      {
        execute: async () => {
          await reportedOnce;
          return 'completed';
        },
      },
      {
        leaseRenewIntervalMs: 5,
        onError: (error) => {
          reported = error;
          onReported();
        },
      },
    );
    vi.spyOn(store, 'renewLease').mockRejectedValue(new Error('store unavailable'));

    await worker.runOnce();
    await drained(worker);

    expect(reported).toEqual(new Error('store unavailable'));
    expect(store.getJob('job-1')?.state).toBe('completed');
  });

  it('does not stack a second renewal on one that has not answered', async () => {
    let answer: (renewed: boolean) => void = () => undefined;
    const { store, worker } = setup(
      {
        execute: async () => {
          await new Promise((resolve) => setTimeout(resolve, 60));
          return 'completed';
        },
      },
      { leaseRenewIntervalMs: 5 },
    );
    const renew = vi.spyOn(store, 'renewLease').mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          answer = resolve;
        }),
    );

    await worker.runOnce();
    await drained(worker);
    answer(true);

    // ~12 intervals elapsed; every one after the first found a renewal in flight.
    expect(renew).toHaveBeenCalledTimes(1);
    expect(store.getJob('job-1')?.state).toBe('completed');
  });
});

describe('ExecutionWorker.runOnce', () => {
  it('fills every free slot and no more', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const statuses: JobResultStatus[] = [];
    const { store, worker } = setup(
      {
        execute: async () => {
          await gate;
          statuses.push('completed');
          return 'completed';
        },
      },
      { slots: 2 },
    );
    store.addJob({ id: 'job-2', runId: 'run-2', workspaceId: 'workspace-1' });
    store.addJob({ id: 'job-3', runId: 'run-3', workspaceId: 'workspace-1' });

    const { claimed } = await worker.runOnce();

    expect(claimed).toHaveLength(2);
    expect(worker.activeJobIds()).toHaveLength(2);
    release();
    await drained(worker);
    expect(statuses).toHaveLength(2);
    expect(store.listJobs().filter((job) => job.state === 'queued')).toHaveLength(1);
  });
});

describe('ExecutionWorker.run', () => {
  it('reports an unavailable store and stays unready', async () => {
    const errors: unknown[] = [];
    const { store, worker } = setup(
      { execute: () => Promise.resolve('completed') },
      {
        onError: (error) => {
          errors.push(error);
          worker.stop();
        },
      },
    );
    vi.spyOn(store, 'ping').mockResolvedValue(false);
    const reap = vi.spyOn(store, 'reapExpiredLeases');

    await worker.run();

    expect(errors).toEqual([new Error('Execution store is unavailable')]);
    expect(reap).not.toHaveBeenCalled();
    expect(worker.isReady()).toBe(false);
    expect(store.getJob('job-1')?.state).toBe('queued');
  });

  it('writes to stderr when no error handler is given', async () => {
    const { store, worker } = setup({ execute: () => Promise.resolve('completed') });
    vi.spyOn(store, 'ping')
      .mockRejectedValueOnce(new TypeError('boom'))
      .mockRejectedValueOnce('down')
      .mockImplementation(() => {
        worker.stop();
        return Promise.resolve(false);
      });
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await worker.run();

    // The name of an Error, a fixed code for anything else — never the message, which
    // is where a connection string would be.
    expect(stderr.mock.calls).toEqual([
      ['worker job failed (TypeError)'],
      ['worker job failed (WORKER_ERROR)'],
      ['worker job failed (Error)'],
    ]);
  });

  it('becomes ready after a successful poll and stops on the external signal', async () => {
    const { worker } = setup({ execute: () => Promise.resolve('completed') });
    const lifecycle = new AbortController();

    const running = worker.run(lifecycle.signal);
    await vi.waitFor(() => expect(worker.isReady()).toBe(true));
    lifecycle.abort();
    await running;

    expect(worker.isReady()).toBe(false);
  });

  it('does not poll at all under a signal that is already aborted', async () => {
    const { store, worker } = setup({ execute: () => Promise.resolve('completed') });
    const ping = vi.spyOn(store, 'ping');
    const lifecycle = new AbortController();
    lifecycle.abort();

    await worker.run(lifecycle.signal);

    expect(ping).not.toHaveBeenCalled();
    expect(store.getJob('job-1')?.state).toBe('queued');
  });
});
