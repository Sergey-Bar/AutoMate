import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useAnalytics, useQuarantine, useReleaseReadiness, useRunDetail } from './useDashboard.js';
import { makeApi, makeRun, TEST_TIMESTAMP } from '../test-utils.js';
import type { RunEventSubscription } from '../lib/api.js';

const gate = {
  id: 'gate-1',
  runId: 'run-a',
  releaseId: 'release-1',
  policyId: 'policy-1',
  policyVersion: '1',
  policyHash: 'b'.repeat(64),
  status: 'unknown' as const,
  decision: 'unknown' as const,
  reasons: [],
  evidenceRefs: [],
  domainStatuses: {
    browser: 'unknown' as const,
    api: 'not_configured' as const,
    mobile: 'not_configured' as const,
    performance: 'not_configured' as const,
    security: 'not_configured' as const,
    accessibility: 'not_configured' as const,
    other: 'not_configured' as const,
  },
  evaluatedAt: TEST_TIMESTAMP,
};

describe('dashboard hooks', () => {
  it('loads analytics and exposes failures', async () => {
    const success = renderHook(() =>
      useAnalytics(
        makeApi({
          getAnalyticsSummary: vi
            .fn()
            .mockResolvedValue({ totalRuns: 3, passRate: 66.7, avgDurationMs: 1_200 }),
        }),
      ),
    );
    await waitFor(() => expect(success.result.current.isLoading).toBe(false));
    expect(success.result.current.data?.totalRuns).toBe(3);
    success.unmount();

    const failure = renderHook(() =>
      useAnalytics(
        makeApi({
          getAnalyticsSummary: vi.fn().mockRejectedValue(new Error('analytics unavailable')),
        }),
      ),
    );
    await waitFor(() =>
      expect(failure.result.current.error?.message).toBe('analytics unavailable'),
    );
  });

  it('refetches run detail when the id changes', async () => {
    const api = makeApi({ getRun: vi.fn(async (id: string) => makeRun({ id })) });
    const { result, rerender } = renderHook(({ id }) => useRunDetail(id, api), {
      initialProps: { id: 'run-a' },
    });
    await waitFor(() => expect(result.current.run?.id).toBe('run-a'));
    rerender({ id: 'run-b' });
    await waitFor(() => expect(result.current.run?.id).toBe('run-b'));
    expect(api.getRun).toHaveBeenCalledWith('run-a');
    expect(api.getRun).toHaveBeenCalledWith('run-b');
  });

  it('loads artifacts, gate, and release readiness without hiding the run', async () => {
    const run = makeRun({ id: 'run-a' });
    const artifact = {
      id: 'artifact-1',
      runId: run.id,
      jobId: null,
      testId: null,
      kind: 'json',
      name: 'results.json',
      contentType: 'application/json',
      storageKey: 'runs/run-a/results.json',
      checksum: 'a'.repeat(64),
      sizeBytes: 20,
      createdAt: TEST_TIMESTAMP,
      expiresAt: null,
      legalHold: false,
      metadata: {},
    };
    const readiness = {
      releaseId: 'release-1',
      decision: 'unknown' as const,
      browser: 'unknown' as const,
      domains: gate.domainStatuses,
      latestRunId: run.id,
      gate,
      evaluatedAt: TEST_TIMESTAMP,
    };
    const api = makeApi({
      getRun: vi.fn().mockResolvedValue(run),
      getRunArtifacts: vi.fn().mockResolvedValue([artifact]),
      getRunGate: vi.fn().mockResolvedValue(gate),
      getReleaseReadiness: vi.fn().mockResolvedValue(readiness),
    });
    const { result } = renderHook(() => useRunDetail(run.id, api));
    await waitFor(() => expect(result.current.gate).toEqual(gate));
    expect(result.current.run?.id).toBe(run.id);
    expect(result.current.artifacts[0]?.name).toBe('results.json');
    expect(result.current.readiness?.decision).toBe('unknown');
  });

  it('exposes cancel and retry actions', async () => {
    const active = makeRun({ id: 'active', phase: 'running' });
    const cancelled = makeRun({ id: 'active', phase: 'cancelled', outcome: 'cancelled' });
    const retried = makeRun({ id: 'retry', phase: 'queued' });
    const api = makeApi({
      getRun: vi.fn().mockResolvedValueOnce(active).mockResolvedValue(cancelled),
      cancelRun: vi.fn().mockResolvedValue(cancelled),
      retryRun: vi.fn().mockResolvedValue(retried),
    });
    const { result } = renderHook(() => useRunDetail('active', api));
    await waitFor(() => expect(result.current.run?.phase).toBe('running'));
    await act(async () => {
      await result.current.cancel();
    });
    await waitFor(() => expect(result.current.run?.phase).toBe('cancelled'));
    const next = await result.current.retry();
    expect(next.id).toBe('retry');
  });

  it('surfaces run detail errors', async () => {
    const api = makeApi({ getRun: vi.fn().mockRejectedValue(new Error('run not found')) });
    const { result } = renderHook(() => useRunDetail('missing', api));
    await waitFor(() => expect(result.current.error?.message).toBe('run not found'));
    expect(result.current.run).toBeNull();
  });

  it('loads and appends quarantine entries', async () => {
    const api = makeApi({
      getQuarantine: vi
        .fn()
        .mockResolvedValue([
          {
            id: 'q-1',
            testTitle: 'existing',
            testFile: 'tests/existing.spec.ts',
            reason: null,
            quarantinedAt: TEST_TIMESTAMP,
          },
        ]),
      addQuarantine: vi.fn().mockResolvedValue({
        id: 'q-2',
        testTitle: 'new flaky test',
        testFile: 'tests/new.spec.ts',
        reason: 'intermittent timeout',
        quarantinedAt: TEST_TIMESTAMP,
      }),
    });
    const { result } = renderHook(() => useQuarantine(api));
    await waitFor(() => expect(result.current.data).toHaveLength(1));
    await act(async () => {
      await result.current.addQuarantine({
        testTitle: 'new flaky test',
        testFile: 'tests/new.spec.ts',
      });
    });
    expect(result.current.data.map((entry) => entry.id)).toEqual(['q-1', 'q-2']);
  });

  it('loads release readiness and reports failures', async () => {
    const api = makeApi({
      getReleaseReadiness: vi.fn().mockRejectedValue(new Error('readiness unavailable')),
    });
    const { result } = renderHook(() => useReleaseReadiness('release-1', api));
    await waitFor(() => expect(result.current.error?.message).toBe('readiness unavailable'));
  });

  it('preserves run state when auxiliary evidence refreshes fail, then recovers', async () => {
    const run = makeRun({ id: 'run-a' });
    const api = makeApi({
      getRun: vi.fn().mockResolvedValue(run),
      getRunArtifacts: vi.fn().mockRejectedValue(new Error('artifacts offline')),
      getRunGate: vi.fn().mockRejectedValue(new Error('gate offline')),
      getReleaseReadiness: vi.fn().mockRejectedValue(new Error('readiness offline')),
    });
    const { result } = renderHook(() => useRunDetail(run.id, api));
    await waitFor(() =>
      expect(result.current.evidenceError?.message).toBe('Some run evidence could not be loaded'),
    );
    expect(result.current.run?.id).toBe(run.id);

    vi.mocked(api.getRunArtifacts).mockResolvedValue([]);
    vi.mocked(api.getRunGate).mockResolvedValue(null);
    vi.mocked(api.getReleaseReadiness).mockResolvedValue(null);
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.evidenceError).toBeNull();
  });

  it('deduplicates timeline events and refreshes for evidence updates', async () => {
    let subscription: RunEventSubscription | undefined;
    const run = makeRun({ id: 'run-a' });
    const artifact = {
      id: 'artifact-live',
      runId: run.id,
      jobId: null,
      testId: null,
      kind: 'log',
      name: 'runner.log',
      contentType: 'text/plain',
      storageKey: 'runs/run-a/runner.log',
      checksum: 'c'.repeat(64),
      sizeBytes: 10,
      createdAt: TEST_TIMESTAMP,
      expiresAt: null,
      legalHold: false,
      metadata: {},
    };
    const api = makeApi({
      getRun: vi.fn().mockResolvedValue(run),
      subscribeToRunEvents: vi.fn((value) => {
        subscription = value;
        return () => undefined;
      }),
    });
    const { result } = renderHook(() => useRunDetail(run.id, api));
    await waitFor(() => expect(result.current.run?.id).toBe(run.id));
    const artifactEvent = {
      version: '1' as const,
      eventId: 'artifact-event',
      sequence: 1,
      occurredAt: TEST_TIMESTAMP,
      runId: run.id,
      type: 'artifact.created' as const,
      payload: { artifact },
    };
    act(() => {
      subscription?.onEvent(artifactEvent);
      subscription?.onEvent(artifactEvent);
    });
    expect(result.current.events).toHaveLength(1);
    await waitFor(() => expect(api.getRun).toHaveBeenCalledTimes(2));

    act(() => subscription?.onConnectionChange?.(true));
    expect(result.current.isLive).toBe(true);
  });

  it('retains action errors for cancel and retry failures', async () => {
    const run = makeRun({ id: 'run-a', phase: 'running' });
    const api = makeApi({
      getRun: vi.fn().mockResolvedValue(run),
      cancelRun: vi.fn().mockRejectedValue(new Error('cancel rejected')),
      retryRun: vi.fn().mockRejectedValue(new Error('retry rejected')),
    });
    const { result } = renderHook(() => useRunDetail(run.id, api));
    await waitFor(() => expect(result.current.run?.id).toBe(run.id));
    await act(async () => {
      await expect(result.current.cancel()).rejects.toThrow('cancel rejected');
    });
    expect(result.current.actionError?.message).toBe('cancel rejected');
    await act(async () => {
      await expect(result.current.retry()).rejects.toThrow('retry rejected');
    });
    expect(result.current.actionError?.message).toBe('retry rejected');
  });

  it('handles absent release IDs and quarantine failures without network calls', async () => {
    const api = makeApi({
      getQuarantine: vi.fn().mockRejectedValue(new Error('quarantine offline')),
    });
    const readiness = renderHook(() => useReleaseReadiness(null, api));
    await waitFor(() => expect(readiness.result.current.isLoading).toBe(false));
    expect(api.getReleaseReadiness).not.toHaveBeenCalled();
    const quarantine = renderHook(() => useQuarantine(api));
    await waitFor(() =>
      expect(quarantine.result.current.error?.message).toBe('quarantine offline'),
    );
  });

  it('ignores run detail results that resolve after unmount', async () => {
    let resolveRun: (run: ReturnType<typeof makeRun>) => void = () => undefined;
    const api = makeApi({
      getRun: vi.fn(
        () =>
          new Promise<ReturnType<typeof makeRun>>((resolve) => {
            resolveRun = resolve;
          }),
      ),
    });
    const { result, unmount } = renderHook(() => useRunDetail('late', api));
    unmount();
    await act(async () => {
      resolveRun(makeRun({ id: 'late' }));
      await Promise.resolve();
    });
    expect(result.current.run).toBeNull();
  });

  it('refetches authoritative detail after an SSE reconnect', async () => {
    let subscription: RunEventSubscription | undefined;
    const run = makeRun({ id: 'run-reconnect' });
    const api = makeApi({
      getRun: vi.fn().mockResolvedValue(run),
      subscribeToRunEvents: vi.fn((value) => {
        subscription = value;
        return () => undefined;
      }),
    });
    const { result } = renderHook(() => useRunDetail(run.id, api));
    await waitFor(() => expect(result.current.run?.id).toBe(run.id));
    act(() => subscription?.onReconnect?.());
    await waitFor(() => expect(api.getRun).toHaveBeenCalledTimes(2));
  });

  it('normalizes non-Error action failures', async () => {
    const run = makeRun({ id: 'run-actions', phase: 'running' });
    const api = makeApi({
      getRun: vi.fn().mockResolvedValue(run),
      cancelRun: vi.fn().mockRejectedValue('cancel offline'),
      retryRun: vi.fn().mockRejectedValue('retry offline'),
    });
    const { result } = renderHook(() => useRunDetail(run.id, api));
    await waitFor(() => expect(result.current.run?.id).toBe(run.id));
    await act(async () => {
      await expect(result.current.cancel()).rejects.toThrow('Failed to cancel run');
    });
    await act(async () => {
      await expect(result.current.retry()).rejects.toThrow('Failed to retry run');
    });
  });

  it('normalizes non-Error load failures across dashboard hooks', async () => {
    const api = makeApi({
      getRun: vi.fn().mockRejectedValue('run offline'),
      getReleaseReadiness: vi.fn().mockRejectedValue('readiness offline'),
      getQuarantine: vi.fn().mockRejectedValue('quarantine offline'),
    });
    const detail = renderHook(() => useRunDetail('offline', api));
    await waitFor(() => expect(detail.result.current.error?.message).toBe('Failed to fetch run'));
    detail.unmount();
    const readiness = renderHook(() => useReleaseReadiness('release-offline', api));
    await waitFor(() =>
      expect(readiness.result.current.error?.message).toBe('Release readiness unavailable'),
    );
    readiness.unmount();
    const quarantine = renderHook(() => useQuarantine(api));
    await waitFor(() =>
      expect(quarantine.result.current.error?.message).toBe('Quarantine unavailable'),
    );
  });
});
