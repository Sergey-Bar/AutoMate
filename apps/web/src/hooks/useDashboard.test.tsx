import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useAnalytics, useQuarantine, useReleaseReadiness, useRunDetail } from './useDashboard.js';
import {
  abortError,
  deferred,
  fetchAborting,
  makeApi,
  makeRun,
  TEST_TIMESTAMP,
} from '../test-utils.js';
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
    expect(api.getRun).toHaveBeenCalledWith('run-a', { signal: expect.any(AbortSignal) });
    expect(api.getRun).toHaveBeenCalledWith('run-b', { signal: expect.any(AbortSignal) });
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

  it('treats a cancelled refresh as no answer, not as missing evidence', async () => {
    // The distinction `foldEvidence` exists to make. A refresh that is superseded —
    // the id changed, or the component unmounted — aborts all three evidence requests
    // together, so every one of them rejects with an `AbortError`. Reporting that as
    // "Some run evidence could not be loaded" would put an error on screen for a
    // request nobody is waiting for any more.
    const run = makeRun({ id: 'run-a' });
    const api = makeApi({
      getRun: vi.fn().mockResolvedValue(run),
      getRunArtifacts: vi.fn().mockRejectedValue(abortError()),
      getRunGate: vi.fn().mockRejectedValue(abortError()),
      getReleaseReadiness: vi.fn().mockRejectedValue(abortError()),
    });
    const { result, unmount } = renderHook(() => useRunDetail(run.id, api));
    await waitFor(() => expect(result.current.run?.id).toBe(run.id));
    expect(result.current.evidenceError).toBeNull();
    unmount();
  });

  it('reports partial evidence when a request fails for a reason other than cancellation', async () => {
    // The other half of the same distinction: an abort means nobody wants the answer,
    // a failure means the answer is missing. Conflating them is how a transient 503
    // becomes an invisible blank panel.
    const run = makeRun({ id: 'run-a' });
    const api = makeApi({
      getRun: vi.fn().mockResolvedValue(run),
      getRunArtifacts: vi.fn().mockRejectedValue(new Error('gateway timeout')),
      getRunGate: vi.fn().mockResolvedValue(gate),
      getReleaseReadiness: vi.fn().mockResolvedValue(null),
    });
    const { result } = renderHook(() => useRunDetail(run.id, api));
    await waitFor(() => expect(result.current.evidenceError).not.toBeNull());
    expect(result.current.evidenceError?.message).toBe('Some run evidence could not be loaded');
    // The run and the evidence that did arrive are still rendered: a partial answer is
    // not a reason to hide what is known.
    expect(result.current.run?.id).toBe(run.id);
    expect(result.current.gate).toEqual(gate);
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
      getQuarantine: vi.fn().mockResolvedValue([
        {
          id: 'q-1',
          testTitle: 'existing',
          testFile: 'tests/existing.spec.ts',
          reason: null,
          quarantinedAt: TEST_TIMESTAMP,
          status: 'pending',
        },
      ]),
      addQuarantine: vi.fn().mockResolvedValue({
        id: 'q-2',
        testTitle: 'new flaky test',
        testFile: 'tests/new.spec.ts',
        reason: 'intermittent timeout',
        quarantinedAt: TEST_TIMESTAMP,
        status: 'pending',
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

/** The options argument every `ApiClient` method takes as its second parameter. */
interface RequestOptionsLike {
  signal?: AbortSignal;
}

/**
 * A request that behaves like a real one: it stays open until its signal
 * aborts, and then rejects with an `AbortError`.
 */
function openUntilAborted(
  record: (signal: AbortSignal) => void,
): (_id: string, options?: RequestOptionsLike) => Promise<never> {
  return (_id, options) => {
    if (options?.signal) record(options.signal);
    return fetchAborting(options?.signal);
  };
}

function signalAt(call: unknown[] | undefined, index: number): AbortSignal | undefined {
  return (call?.[index] as RequestOptionsLike | undefined)?.signal;
}

describe('dashboard hook cancellation', () => {
  it('aborts the run request and cancels the whole snapshot on unmount', async () => {
    const signals: Record<string, AbortSignal> = {};
    const record = (key: string) => (signal: AbortSignal) => {
      signals[key] = signal;
    };
    const run = makeRun({ id: 'run-a' });
    const api = makeApi({
      getRun: vi.fn((_id, options) => {
        record('getRun')(options?.signal as AbortSignal);
        return Promise.resolve(run);
      }),
      getRunArtifacts: vi.fn(openUntilAborted(record('getRunArtifacts'))),
      getRunGate: vi.fn(openUntilAborted(record('getRunGate'))),
      getReleaseReadiness: vi.fn(openUntilAborted(record('getReleaseReadiness'))),
    });

    const { result, unmount } = renderHook(() => useRunDetail('run-a', api));
    await waitFor(() =>
      expect(Object.keys(signals).sort()).toEqual([
        'getReleaseReadiness',
        'getRun',
        'getRunArtifacts',
        'getRunGate',
      ]),
    );
    for (const [key, signal] of Object.entries(signals)) {
      expect(signal.aborted, `${key} should still be open`).toBe(false);
    }

    unmount();

    for (const [key, signal] of Object.entries(signals)) {
      expect(signal.aborted, `${key} should be aborted on unmount`).toBe(true);
    }
    expect(result.current.error).toBeNull();
  });

  it('shares one signal across the run and its evidence, so a refresh cancels all of it', async () => {
    const run = makeRun({ id: 'run-a' });
    const signals: AbortSignal[] = [];
    const api = makeApi({
      getRun: vi.fn((_id, options) => {
        if (options?.signal) signals.push(options.signal);
        return Promise.resolve(run);
      }),
      getRunArtifacts: vi.fn((_id, options) => {
        if (options?.signal) signals.push(options.signal);
        return fetchAborting(options?.signal);
      }),
      getRunGate: vi.fn((_id, options) => {
        if (options?.signal) signals.push(options.signal);
        return fetchAborting(options?.signal);
      }),
      getReleaseReadiness: vi.fn((_id, options) => {
        if (options?.signal) signals.push(options.signal);
        return fetchAborting(options?.signal);
      }),
    });

    const { result, unmount } = renderHook(() => useRunDetail('run-a', api));
    await waitFor(() => expect(result.current.run?.id).toBe('run-a'));
    expect(signals.length).toBeGreaterThanOrEqual(3);
    // A snapshot assembled from endpoints that were not cancelled together can
    // mix two different moments in time.
    expect(new Set(signals).size).toBe(1);
    // The run request and the evidence sweep are the same snapshot, so they
    // arrive under one signal rather than two independent ones.
    expect(signalAt(vi.mocked(api.getRun).mock.calls[0], 1)).toBe(signals[0]);
    expect(signalAt(vi.mocked(api.getRunArtifacts).mock.calls[0], 1)).toBe(signals[0]);

    await act(async () => {
      void result.current.refresh();
      await Promise.resolve();
    });

    expect(signals[0]?.aborted).toBe(true);
    expect(new Set(signals).size).toBe(2);
    unmount();
    for (const signal of signals) expect(signal.aborted).toBe(true);
  });

  it('does not report a cancelled evidence sweep as missing evidence', async () => {
    const run = makeRun({ id: 'run-a' });
    const api = makeApi({
      getRun: vi.fn().mockResolvedValue(run),
      getRunArtifacts: vi.fn((_id, options) => fetchAborting(options?.signal)),
      getRunGate: vi.fn((_id, options) => fetchAborting(options?.signal)),
      getReleaseReadiness: vi.fn((_id, options) => fetchAborting(options?.signal)),
    });

    const { result, unmount } = renderHook(() => useRunDetail('run-a', api));
    await waitFor(() => expect(result.current.run?.id).toBe('run-a'));
    await act(async () => {
      await Promise.resolve();
    });

    // "Some run evidence could not be refreshed" is a claim about the server. A
    // request this hook cancelled says nothing about the server.
    expect(result.current.evidenceError).toBeNull();

    unmount();
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.evidenceError).toBeNull();
  });

  it('aborts analytics, quarantine and readiness loads on unmount', async () => {
    const analyticsSignals: AbortSignal[] = [];
    const analytics = renderHook(() =>
      useAnalytics(
        makeApi({
          getAnalyticsSummary: vi.fn((options) => {
            if (options?.signal) analyticsSignals.push(options.signal);
            return fetchAborting(options?.signal);
          }),
        }),
      ),
    );
    await waitFor(() => expect(analyticsSignals).toHaveLength(1));
    analytics.unmount();
    expect(analyticsSignals[0]?.aborted).toBe(true);

    const quarantineSignals: AbortSignal[] = [];
    const quarantine = renderHook(() =>
      useQuarantine(
        makeApi({
          getQuarantine: vi.fn((options) => {
            if (options?.signal) quarantineSignals.push(options.signal);
            return fetchAborting(options?.signal);
          }),
        }),
      ),
    );
    await waitFor(() => expect(quarantineSignals).toHaveLength(1));
    quarantine.unmount();
    expect(quarantineSignals[0]?.aborted).toBe(true);

    const readinessSignals: AbortSignal[] = [];
    const readiness = renderHook(() =>
      useReleaseReadiness(
        'release-1',
        makeApi({
          getReleaseReadiness: vi.fn((_id, options) => {
            if (options?.signal) readinessSignals.push(options.signal);
            return fetchAborting(options?.signal);
          }),
        }),
      ),
    );
    await waitFor(() => expect(readinessSignals).toHaveLength(1));
    readiness.unmount();
    expect(readinessSignals[0]?.aborted).toBe(true);
  });

  it('does not write an action result into a component that has unmounted', async () => {
    const run = makeRun({ id: 'run-a', phase: 'running' });
    const cancelled = makeRun({ id: 'run-a', phase: 'cancelled', outcome: 'cancelled' });
    const pending = deferred<ReturnType<typeof makeRun>>();
    const api = makeApi({
      getRun: vi.fn().mockResolvedValue(run),
      getRunArtifacts: vi.fn().mockResolvedValue([]),
      getRunGate: vi.fn().mockResolvedValue(null),
      getReleaseReadiness: vi.fn().mockResolvedValue(null),
      cancelRun: vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue(cancelled),
    });

    const { result, unmount } = renderHook(() => useRunDetail('run-a', api));
    await waitFor(() => expect(result.current.run?.phase).toBe('running'));
    const inFlight = result.current.cancel();
    await act(async () => {
      await Promise.resolve();
    });
    unmount();

    // The cancel resolves after the component is gone. It must be returned to its
    // caller and written nowhere: the run is not replaced with the cancelled one,
    // no error is raised, and `isActing` is left at the value it had — still
    // `true`, because writing `false` to a dead component is itself the write.
    await act(async () => {
      pending.resolve(cancelled);
      await expect(inFlight).resolves.toMatchObject({ phase: 'cancelled' });
    });
    expect(result.current.run?.phase).toBe('running');
    expect(result.current.actionError).toBeNull();
    expect(result.current.isActing).toBe(true);
  });
});

describe('dashboard hook failure and emptiness', () => {
  it('keeps the previously-good run and evidence when a later refresh fails', async () => {
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
    const api = makeApi({
      getRun: vi
        .fn()
        .mockResolvedValueOnce(run)
        .mockRejectedValue(new TypeError('Failed to fetch')),
      getRunArtifacts: vi.fn().mockResolvedValue([artifact]),
      getRunGate: vi.fn().mockResolvedValue(null),
      getReleaseReadiness: vi.fn().mockResolvedValue(null),
    });

    const { result } = renderHook(() => useRunDetail('run-a', api));
    await waitFor(() => expect(result.current.artifacts).toHaveLength(1));

    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.error?.message).toBe('Failed to fetch');
    // The run detail page renders the run above the error. Emptying the evidence
    // would render a run as having produced nothing.
    expect(result.current.run?.id).toBe('run-a');
    expect(result.current.artifacts[0]?.name).toBe('results.json');
  });

  it('distinguishes an empty-but-valid run detail from a failure', async () => {
    const api = makeApi({
      getRun: vi.fn().mockResolvedValue(makeRun({ id: 'run-a', tests: [] })),
      getRunArtifacts: vi.fn().mockResolvedValue([]),
      getRunGate: vi.fn().mockResolvedValue(null),
      getReleaseReadiness: vi.fn().mockResolvedValue(null),
    });

    const { result } = renderHook(() => useRunDetail('run-a', api));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toBeNull();
    expect(result.current.evidenceError).toBeNull();
    expect(result.current.run?.id).toBe('run-a');
    expect(result.current.artifacts).toEqual([]);
    expect(result.current.gate).toBeNull();
    expect(result.current.readiness).toBeNull();
  });

  it('keeps a loaded analytics summary when a remounted request fails', async () => {
    const good = { totalRuns: 4, passRate: 75, avgDurationMs: 900 };
    const api = makeApi({
      getAnalyticsSummary: vi
        .fn()
        .mockResolvedValueOnce(good)
        .mockRejectedValue(new TypeError('offline')),
    });

    const first = renderHook(() => useAnalytics(api));
    await waitFor(() => expect(first.result.current.data).toEqual(good));
    first.unmount();

    const second = renderHook(() => useAnalytics(api));
    await waitFor(() => expect(second.result.current.error).not.toBeNull());
    // The same hook, a new mount: a null here is what renders an empty summary
    // card as though the workspace had no runs.
    expect(second.result.current.data).toBeNull();
  });

  it('does not throw past the hook when a detail load rejects with a contract error', async () => {
    const { ResponseContractError } = await import('../lib/api.js');
    const api = makeApi({
      getRun: vi
        .fn()
        .mockRejectedValue(
          new ResponseContractError(
            'Response from /api/v1/runs/run-a was not JSON',
            '/api/v1/runs/run-a',
            200,
          ),
        ),
    });

    const { result } = renderHook(() => useRunDetail('run-a', api));
    await waitFor(() => expect(result.current.error).toBeInstanceOf(ResponseContractError));
    expect(result.current.isLoading).toBe(false);
    expect(result.current.run).toBeNull();
  });

  it('surfaces a cancelled refresh as neither a run error nor missing evidence', async () => {
    const run = makeRun({ id: 'run-a' });
    const api = makeApi({
      getRun: vi
        .fn()
        .mockResolvedValueOnce(run)
        // A refresh whose request was cancelled before it answered — what a
        // superseding poll or a navigation produces.
        .mockRejectedValue(abortError()),
      getRunArtifacts: vi.fn().mockResolvedValue([]),
      getRunGate: vi.fn().mockResolvedValue(null),
      getReleaseReadiness: vi.fn().mockResolvedValue(null),
    });

    const { result } = renderHook(() => useRunDetail('run-a', api));
    await waitFor(() => expect(result.current.run?.id).toBe('run-a'));
    await act(async () => {
      await result.current.refresh();
    });

    // "Run unavailable" for a request the client itself cancelled is a false
    // alarm, and so is "some evidence could not be loaded".
    expect(result.current.error).toBeNull();
    expect(result.current.evidenceError).toBeNull();
    expect(result.current.run?.id).toBe('run-a');
  });
});
