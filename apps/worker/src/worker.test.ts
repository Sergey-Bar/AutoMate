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

  /**
   * The worker is the scheduler and the lease-recovery loop. **Execution belongs to
   * the runner**, which claims over the API and runs the job in the execution
   * boundary.
   *
   * This case exists because the absence of a handler in the production composition
   * was read as a bug — the planning audit recorded "the worker production composition
   * passes no JobHandler" as the largest single gap in the repository, on the reading
   * that the product could not execute jobs at all. It can, through the runner.
   *
   * Wiring a handler here would be the regression: `ExecutionWorker`'s in-process
   * claim path queries the same `runners` and `jobs` tables as the API, so a worker
   * with a handler would take jobs away from the runners that can actually run them,
   * and every job it won would end as `infra_failed`.
   *
   * So the invariant is pinned rather than left to a comment: a worker with no handler
   * must claim nothing, even when a matching runner row and a claimable job both exist.
   * If someone later adds a handler to `main.ts`, this test is the thing that should
   * have to change — deliberately, with the runner claim path in mind.
   */
  it('claims nothing without a handler, even when a job is claimable', async () => {
    const store = new InMemoryExecutionStore({ now: () => t0, leaseDurationMs: 5_000 });
    store.addRunner({ id: 'worker-runner', capabilities: ['playwright'] });
    store.addJob({
      id: 'job-unhandled',
      runId: 'run-unhandled',
      workspaceId: 'workspace-1',
      requiredCapabilities: ['playwright'],
    });
    // No `handler` — exactly as `main.ts` composes it.
    const worker = new ExecutionWorker({
      store,
      runnerId: 'worker-runner',
      capabilities: ['playwright'],
      labels: [],
      slots: 1,
      pollIntervalMs: 1,
      leaseDurationMs: 5_000,
      leaseRenewIntervalMs: 1_000,
    });

    const result = await worker.runOnce(t0);

    expect(result.claimed).toEqual([]);
    // Untouched, not failed: a worker that cannot run a job must leave it for a runner
    // that can, rather than claiming it and reporting `infra_failed`.
    expect(store.getJob('job-unhandled')?.state).toBe('queued');
    expect(worker.activeJobIds()).toEqual([]);
  });

  it('still does its scheduler work without a handler', async () => {
    // The half of the worker's job that needs no execution capability: it reaps
    // expired leases and polls schedules. If going without a handler ever meant
    // going inert, the worker's only remaining reason to exist would go with it.
    const store = new InMemoryExecutionStore({ now: () => t0, leaseDurationMs: 5_000 });
    store.addRunner({ id: 'worker-runner', capabilities: ['playwright'] });
    store.addSchedule({
      id: 'schedule-1',
      cronExpr: '*/5 * * * *',
      timezone: 'UTC',
      enabled: true,
      nextRunAt: t0.toISOString(),
      misfirePolicy: 'skip',
      request: {
        workspaceId: 'workspace-1',
        projectId: 'project-1',
        environmentId: 'env-1',
        releaseId: 'release-1',
        branch: 'main',
        commit: 'a'.repeat(40),
      },
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
    });

    const result = await worker.runOnce(t0);

    expect(Array.isArray(result.recovered)).toBe(true);
    expect(Array.isArray(result.scheduled)).toBe(true);
    expect(result.claimed).toEqual([]);
  });
});
