import { describe, expect, it } from 'vitest';
import { InMemoryExecutionStore } from './in-memory-store.js';
import { ExecutionWorker } from './worker.js';

const t0 = new Date('2026-01-01T00:00:00.000Z');

describe('ExecutionWorker', () => {
  it('polls, renews leases, executes a claimed job, and drains on shutdown', async () => {
    const store = new InMemoryExecutionStore({ now: () => t0, leaseDurationMs: 5_000 });
    store.addRunner({ id: 'worker-runner', capabilities: ['playwright'] });
    store.addJob({
      id: 'job-1',
      runId: 'run-1',
      workspaceId: 'workspace-1',
      requiredCapabilities: ['playwright'],
    });
    const worker = new ExecutionWorker({
      store,
      runnerId: 'worker-runner',
      capabilities: ['playwright'],
      labels: [],
      slots: 1,
      pollIntervalMs: 1,
      leaseDurationMs: 5_000,
      leaseRenewIntervalMs: 1_000,
      handler: {
        execute: async () => 'completed',
      },
    });
    const stop = setTimeout(() => worker.stop(), 20);

    await worker.run();
    clearTimeout(stop);

    expect(store.getJob('job-1')?.state).toBe('completed');
    expect(worker.activeJobIds()).toEqual([]);
    expect(worker.isReady()).toBe(false);
  });

  it('aborts active handlers and records cancellation during graceful stop', async () => {
    const store = new InMemoryExecutionStore({ now: () => t0, leaseDurationMs: 5_000 });
    store.addRunner({ id: 'worker-runner', capabilities: ['playwright'] });
    store.addJob({
      id: 'job-cancel',
      runId: 'run-cancel',
      workspaceId: 'workspace-1',
      requiredCapabilities: ['playwright'],
    });
    const worker = new ExecutionWorker({
      store,
      runnerId: 'worker-runner',
      capabilities: ['playwright'],
      labels: [],
      slots: 1,
      pollIntervalMs: 1,
      leaseDurationMs: 5_000,
      leaseRenewIntervalMs: 1_000,
      handler: {
        execute: async (_claim, signal) => {
          await new Promise<void>((resolve) =>
            signal.addEventListener('abort', () => resolve(), { once: true }),
          );
          return 'completed';
        },
      },
    });
    const stop = setTimeout(() => worker.stop(), 20);

    await worker.run();
    clearTimeout(stop);

    expect(store.getJob('job-cancel')?.state).toBe('cancelled');
  });
});
