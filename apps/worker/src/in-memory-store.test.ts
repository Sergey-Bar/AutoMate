import { describe, expect, it } from 'vitest';
import { InMemoryExecutionStore } from './in-memory-store.js';

const t0 = new Date('2026-01-01T00:00:00.000Z');

describe('InMemoryExecutionStore', () => {
  it('claims atomically by available time, capabilities, labels, and priority', async () => {
    const store = new InMemoryExecutionStore({ now: () => t0 });
    store.addRunner({
      id: 'runner-1',
      capabilities: ['playwright', 'chromium'],
      labels: ['trusted'],
    });
    store.addJob({
      id: 'future',
      runId: 'run-future',
      workspaceId: 'workspace-1',
      priority: 100,
      availableAt: '2026-01-01T00:01:00.000Z',
      requiredCapabilities: ['playwright'],
    });
    store.addJob({
      id: 'wrong-capability',
      runId: 'run-capability',
      workspaceId: 'workspace-1',
      requiredCapabilities: ['safari'],
    });
    store.addJob({
      id: 'wrong-label',
      runId: 'run-label',
      workspaceId: 'workspace-1',
      labels: ['isolated'],
    });
    store.addJob({
      id: 'high',
      runId: 'run-high',
      workspaceId: 'workspace-1',
      priority: 10,
      requiredCapabilities: ['playwright'],
      labels: ['trusted'],
    });
    store.addJob({
      id: 'low',
      runId: 'run-low',
      workspaceId: 'workspace-1',
      priority: 1,
      requiredCapabilities: ['playwright'],
    });

    const [first, duplicate] = await Promise.all([
      store.claimJob('runner-1', [], [], t0),
      store.claimJob('runner-1', [], [], t0),
    ]);

    expect([first?.jobId, duplicate?.jobId].filter(Boolean)).toEqual(['high']);
    expect(
      await store.completeJob('high', {
        leaseId: first!.leaseId,
        fencingToken: first!.fencingToken,
        status: 'completed',
      }),
    ).toBe(true);
    const next = await store.claimJob('runner-1', [], [], t0);
    expect(next?.jobId).toBe('low');
  });

  it('prevents starvation and enforces workspace and project quotas', async () => {
    const fairness = new InMemoryExecutionStore({
      now: () => t0,
      starvationAfterMs: 10_000,
      workspaceQuota: 1,
      projectQuota: 1,
    });
    fairness.addRunner({ id: 'runner-1', capabilities: ['playwright'], slots: 2 });
    fairness.addJob({
      id: 'new-high',
      runId: 'run-new',
      workspaceId: 'workspace-1',
      projectId: 'project-1',
      priority: 1,
      requiredCapabilities: ['playwright'],
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    fairness.addJob({
      id: 'old-low',
      runId: 'run-old',
      workspaceId: 'workspace-1',
      projectId: 'project-1',
      priority: 0,
      requiredCapabilities: ['playwright'],
      createdAt: '2025-12-31T23:59:30.000Z',
    });

    const first = await fairness.claimJob('runner-1', [], [], t0);
    expect(first?.jobId).toBe('old-low');
    expect(await fairness.claimJob('runner-1', [], [], t0)).toBeNull();
  });

  it('rejects stale lease writes before the reaper clears the lease', async () => {
    let now = t0;
    const store = new InMemoryExecutionStore({ now: () => now, leaseDurationMs: 100 });
    store.addRunner({ id: 'runner-1', capabilities: ['playwright'] });
    store.addJob({
      id: 'job-stale',
      runId: 'run-stale',
      workspaceId: 'workspace-1',
      requiredCapabilities: ['playwright'],
    });
    const claim = await store.claimJob('runner-1', [], [], now);
    now = new Date(t0.getTime() + 101);

    expect(
      await store.renewLease(
        'job-stale',
        claim!.leaseId,
        claim!.fencingToken,
        new Date(now.getTime() + 100),
      ),
    ).toBe(false);
    expect(
      await store.completeJob('job-stale', {
        leaseId: claim!.leaseId,
        fencingToken: claim!.fencingToken,
        status: 'completed',
      }),
    ).toBe(false);
    expect((await store.reapExpiredLeases(now))[0]?.jobId).toBe('job-stale');
  });

  it('renews fenced leases, requeues allowed attempts, then marks runner loss', async () => {
    let now = t0;
    const store = new InMemoryExecutionStore({
      now: () => now,
      leaseDurationMs: 100,
      retryBackoffMs: 10,
    });
    store.addRunner({ id: 'runner-1', capabilities: ['playwright'] });
    store.addJob({
      id: 'job-1',
      runId: 'run-1',
      workspaceId: 'workspace-1',
      maxAttempts: 2,
      requiredCapabilities: ['playwright'],
    });

    const first = await store.claimJob('runner-1', [], [], now);
    expect(first).not.toBeNull();
    expect(
      await store.renewLease(
        'job-1',
        first!.leaseId,
        first!.fencingToken,
        new Date(now.getTime() + 200),
      ),
    ).toBe(true);
    now = new Date(t0.getTime() + 201);
    expect((await store.reapExpiredLeases(now))[0]).toMatchObject({
      jobId: 'job-1',
      requeued: true,
      nextAttempt: 2,
      phase: 'queued',
    });
    expect(await store.renewLease('job-1', first!.leaseId, first!.fencingToken, now)).toBe(false);

    now = new Date(t0.getTime() + 211);
    const second = await store.claimJob('runner-1', [], [], now);
    expect(second).toMatchObject({ jobId: 'job-1', attempt: 2, fencingToken: 2 });
    now = new Date(t0.getTime() + 412);
    expect((await store.reapExpiredLeases(now))[0]).toMatchObject({
      requeued: false,
      nextAttempt: 2,
      phase: 'runner_lost',
    });
    expect(store.getJob('job-1')).toMatchObject({ state: 'failed', attempt: 2 });

    store.addJob({
      id: 'job-cancelled',
      runId: 'run-cancelled',
      workspaceId: 'workspace-1',
      maxAttempts: 1,
      requiredCapabilities: ['playwright'],
    });
    const cancelled = await store.claimJob('runner-1', [], [], now);
    expect(cancelled?.jobId).toBe('job-cancelled');
    store.requestCancellation('job-cancelled');
    now = new Date(now.getTime() + 101);
    expect((await store.reapExpiredLeases(now))[0]).toMatchObject({
      jobId: 'job-cancelled',
      requeued: false,
      phase: 'cancelled',
    });
    expect(store.getJob('job-cancelled')?.state).toBe('cancelled');
  });
});
