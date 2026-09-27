import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { RunEventEnvelope } from '@automate/shared-contracts';
import { isRunActive, useRuns } from './useRuns.js';
import { deferred, fetchAborting, makeApi, makePhaseEvent, makeRun } from '../test-utils.js';
import type { ApiClient, RunEventSubscription } from '../lib/api.js';

describe('useRuns', () => {
  it('loads runs and patches canonical phase events without an extra fetch', async () => {
    let subscription: RunEventSubscription | undefined;
    const unsubscribe = vi.fn();
    const running = makeRun({ id: 'run-1', projectId: 'web', phase: 'running' });
    const api = makeApi({
      getRuns: vi.fn().mockResolvedValue([running]),
      subscribeToRunEvents: vi.fn((value) => {
        subscription = value;
        return unsubscribe;
      }),
    });

    const { result, unmount } = renderHook(() => useRuns(api));
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.runs).toEqual([running]);

    act(() => subscription?.onEvent(makePhaseEvent({ phase: 'collecting' })));
    expect(result.current.runs[0]?.phase).toBe('collecting');
    expect(api.getRuns).toHaveBeenCalledOnce();

    unmount();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('refetches instead of synthesizing unknown runs', async () => {
    let subscription: RunEventSubscription | undefined;
    const first = makeRun({ id: 'run-1', phase: 'queued' });
    const second = makeRun({ id: 'run-2', phase: 'queued' });
    const api = makeApi({
      getRuns: vi.fn().mockResolvedValueOnce([first]).mockResolvedValueOnce([second]),
      subscribeToRunEvents: vi.fn((value) => {
        subscription = value;
        return () => undefined;
      }),
    });
    const { result } = renderHook(() => useRuns(api));
    await waitFor(() => expect(result.current.runs).toHaveLength(1));

    act(() => subscription?.onEvent(makePhaseEvent({ runId: 'run-2' })));
    await waitFor(() => expect(result.current.runs[0]?.id).toBe('run-2'));
    expect(api.getRuns).toHaveBeenCalledTimes(2);
  });

  it('refetches authoritative state after an SSE reconnect', async () => {
    let subscription: RunEventSubscription | undefined;
    const initial = makeRun({ id: 'run-1', phase: 'running' });
    const completed = makeRun({ id: 'run-1', phase: 'complete', outcome: 'passed' });
    const api = makeApi({
      getRuns: vi.fn().mockResolvedValueOnce([initial]).mockResolvedValueOnce([completed]),
      subscribeToRunEvents: vi.fn((value) => {
        subscription = value;
        return () => undefined;
      }),
    });
    const { result } = renderHook(() => useRuns(api));
    await waitFor(() => expect(result.current.runs[0]?.phase).toBe('running'));

    act(() => subscription?.onReconnect?.());
    await waitFor(() => expect(result.current.runs[0]?.outcome).toBe('passed'));
  });

  it('surfaces fetch errors and keeps realtime cleanup intact', async () => {
    const unsubscribe = vi.fn();
    const api = makeApi({
      getRuns: vi.fn().mockRejectedValue(new Error('network down')),
      subscribeToRunEvents: vi.fn(() => unsubscribe),
    });
    const { result, unmount } = renderHook(() => useRuns(api));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.runs).toEqual([]);
    expect(result.current.error?.message).toBe('network down');
    unmount();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('does not update state after unmount when the initial fetch resolves late', async () => {
    let resolveRuns: (runs: ReturnType<typeof makeRun>[]) => void = () => undefined;
    const api = makeApi({
      getRuns: vi.fn(
        () =>
          new Promise<ReturnType<typeof makeRun>[]>((resolve) => {
            resolveRuns = resolve;
          }),
      ),
    });
    const { result, unmount } = renderHook(() => useRuns(api));
    expect(result.current.isLoading).toBe(true);
    unmount();
    await act(async () => {
      resolveRuns([makeRun({ id: 'late-run' })]);
      await Promise.resolve();
    });
    expect(result.current.runs).toEqual([]);
  });

  it('projects every canonical run lifecycle event', async () => {
    let subscription: RunEventSubscription | undefined;
    const run = makeRun({ id: 'run-1', phase: 'queued' });
    const api = makeApi({
      getRuns: vi.fn().mockResolvedValue([run]),
      subscribeToRunEvents: vi.fn((value) => {
        subscription = value;
        return () => undefined;
      }),
    });
    const { result } = renderHook(() => useRuns(api));
    await waitFor(() => expect(result.current.runs).toHaveLength(1));

    const base = { version: '1' as const, runId: 'run-1', occurredAt: '2026-09-25T00:00:00.000Z' };
    const events: RunEventEnvelope[] = [
      {
        ...base,
        eventId: '1',
        sequence: 1,
        type: 'run.queued',
        payload: { phase: 'queued', outcome: null, requestedAt: base.occurredAt },
      },
      {
        ...base,
        eventId: '2',
        sequence: 2,
        type: 'run.assigned',
        payload: { phase: 'assigned', outcome: null, jobId: 'job-1', runnerId: 'runner-1' },
      },
      {
        ...base,
        eventId: '3',
        sequence: 3,
        type: 'run.started',
        payload: { phase: 'running', outcome: null, startedAt: base.occurredAt },
      },
      makePhaseEvent({ sequence: 4, phase: 'collecting' }),
      {
        ...base,
        eventId: '5',
        sequence: 5,
        type: 'run.completed',
        payload: {
          phase: 'complete',
          outcome: 'passed',
          finishedAt: base.occurredAt,
          artifactIds: [],
        },
      },
    ];

    act(() => {
      for (const event of events) subscription?.onEvent(event);
    });
    expect(result.current.runs[0]?.phase).toBe('complete');
    expect(result.current.runs[0]?.outcome).toBe('passed');
    expect(result.current.runs[0]?.finishedAt).toBe(base.occurredAt);
  });

  it('refetches for non-phase evidence events and reports connection state', async () => {
    let subscription: RunEventSubscription | undefined;
    const run = makeRun({ id: 'run-1' });
    const api = makeApi({
      getRuns: vi.fn().mockResolvedValue([run]),
      subscribeToRunEvents: vi.fn((value) => {
        subscription = value;
        return () => undefined;
      }),
    });
    const { result } = renderHook(() => useRuns(api));
    await waitFor(() => expect(result.current.runs).toHaveLength(1));

    act(() => subscription?.onConnectionChange?.(true));
    expect(result.current.isLive).toBe(true);
    act(() => {
      subscription?.onEvent({
        version: '1',
        eventId: 'test-event',
        sequence: 1,
        occurredAt: '2026-09-25T00:00:00.000Z',
        runId: 'run-1',
        type: 'test.started',
        payload: {
          testId: 'test-1',
          attempt: 1,
          status: 'running',
          startedAt: '2026-09-25T00:00:00.000Z',
        },
      });
    });
    await waitFor(() => expect(api.getRuns).toHaveBeenCalledTimes(2));
  });

  it('polls authoritative state and clears the timer on unmount', async () => {
    const run = makeRun({ id: 'poll-run' });
    const api = makeApi({
      getRuns: vi.fn().mockResolvedValue([run]),
      subscribeToRunEvents: vi.fn(() => () => undefined),
    });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { result, unmount } = renderHook(() => useRuns(api));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await act(async () => {
      vi.advanceTimersByTime(5000);
      await Promise.resolve();
    });
    expect(api.getRuns).toHaveBeenCalledTimes(2);
    unmount();
    await act(async () => {
      vi.advanceTimersByTime(5000);
      await Promise.resolve();
    });
    expect(api.getRuns).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('classifies active and terminal phases explicitly', () => {
    const active = [
      'queued',
      'assigned',
      'preparing',
      'running',
      'collecting',
      'normalizing',
      'analyzing',
      'gate_evaluation',
    ] as const;
    const terminal = [
      'complete',
      'cancelled',
      'timed_out',
      'runner_lost',
      'infra_failed',
      'config_failed',
      'blocked',
      'partial',
    ] as const;
    expect(active.every((phase) => isRunActive(makeRun({ phase })))).toBe(true);
    expect(terminal.some((phase) => isRunActive(makeRun({ phase })))).toBe(false);
  });

  it('surfaces errors from an explicit authoritative refresh', async () => {
    const api = makeApi({ getRuns: vi.fn().mockRejectedValue(new Error('refresh failed')) });
    const { result } = renderHook(() => useRuns(api));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await act(async () => {
      await result.current.refresh(true);
    });
    expect(result.current.error?.message).toBe('refresh failed');
    expect(result.current.isLoading).toBe(false);
  });
});

/**
 * What happens to a request that is still open when the component stops needing
 * it. Without a signal it holds its connection until the server answers, and the
 * answer then arrives at a component that no longer exists.
 */
describe('useRuns cancellation', () => {
  it('aborts the in-flight request on unmount', async () => {
    const signals: AbortSignal[] = [];
    const api = makeApi({
      getRuns: vi.fn((options) => {
        const signal = (options as { signal?: AbortSignal } | undefined)?.signal;
        if (signal) signals.push(signal);
        return fetchAborting(signal);
      }),
    });

    const { unmount } = renderHook(() => useRuns(api));
    await waitFor(() => expect(signals).toHaveLength(1));
    expect(signals[0]?.aborted).toBe(false);

    unmount();

    expect(signals[0]?.aborted).toBe(true);
  });

  it('aborts the superseded request when a refresh overtakes it', async () => {
    const signals: AbortSignal[] = [];
    const api = makeApi({
      getRuns: vi.fn((options) => {
        const signal = (options as { signal?: AbortSignal } | undefined)?.signal;
        if (signal) signals.push(signal);
        return fetchAborting(signal);
      }),
    });

    const { result } = renderHook(() => useRuns(api));
    await waitFor(() => expect(signals).toHaveLength(1));

    // Not awaited: the replacement request only settles when something aborts it,
    // which is what this test is about.
    await act(async () => {
      void result.current.refresh();
      await Promise.resolve();
    });

    // Two requests, one live: the first is not merely superseded, it is cancelled,
    // so it cannot write over the answer the second one is still waiting for.
    expect(signals).toHaveLength(2);
    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(false);
  });

  it('cancels a superseded poll the same way it cancels a manual refresh', async () => {
    const signals: AbortSignal[] = [];
    const api = makeApi({
      getRuns: vi.fn((options) => {
        const signal = (options as { signal?: AbortSignal } | undefined)?.signal;
        if (signal) signals.push(signal);
        return fetchAborting(signal);
      }),
    });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { unmount } = renderHook(() => useRuns(api));
    await waitFor(() => expect(signals).toHaveLength(1));

    await act(async () => {
      vi.advanceTimersByTime(5000);
      await Promise.resolve();
    });

    expect(signals).toHaveLength(2);
    expect(signals[0]?.aborted).toBe(true);
    unmount();
    expect(signals[1]?.aborted).toBe(true);
    vi.useRealTimers();
  });

  it('does not turn a cancellation into an error state', async () => {
    const api = makeApi({
      // Exactly the transport behaviour of an aborted request: rejects with a
      // DOMException named AbortError and never resolves with data.
      getRuns: vi.fn((options) =>
        fetchAborting((options as { signal?: AbortSignal } | undefined)?.signal),
      ),
    });

    const { result, unmount } = renderHook(() => useRuns(api));
    expect(result.current.isLoading).toBe(true);
    unmount();
    await act(async () => {
      await Promise.resolve();
    });

    // "Runs unavailable" for a request the hook itself cancelled is a lie: the
    // list it was replacing was never wrong.
    expect(result.current.error).toBeNull();
    expect(result.current.runs).toEqual([]);
  });

  it('leaves an earlier failure reported when a newer request supersedes it', async () => {
    const first = deferred<ReturnType<typeof makeRun>[]>();
    const second = deferred<ReturnType<typeof makeRun>[]>();
    const api = makeApi({
      getRuns: vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise),
    });

    const { result } = renderHook(() => useRuns(api));
    const firstSignal = (vi.mocked(api.getRuns).mock.calls[0]?.[0] as { signal: AbortSignal })
      .signal;
    await act(async () => {
      void result.current.refresh();
    });
    expect(firstSignal.aborted).toBe(true);

    await act(async () => {
      first.reject(new TypeError('Failed to fetch'));
      second.resolve([makeRun({ id: 'run-new' })]);
      await Promise.resolve();
    });

    await waitFor(() => expect(result.current.runs[0]?.id).toBe('run-new'));
    // The superseded request's failure is not the answer to the question the
    // newer request is still answering, so it must not become the error state.
    expect(result.current.error).toBeNull();
  });
});

describe('useRuns failure and emptiness', () => {
  it('keeps the last good list when a later refresh fails', async () => {
    const good = [makeRun({ id: 'run-1' }), makeRun({ id: 'run-2' })];
    const api = makeApi({
      getRuns: vi
        .fn()
        .mockResolvedValueOnce(good)
        .mockRejectedValue(new TypeError('Failed to fetch')),
    });

    const { result } = renderHook(() => useRuns(api));
    await waitFor(() => expect(result.current.runs).toHaveLength(2));

    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.error?.message).toBe('Failed to fetch');
    // Rendering the failure as an empty list would tell the user their two runs
    // do not exist. The error is visible alongside the evidence that is still
    // known to be good.
    expect(result.current.runs).toEqual(good);
  });

  it('recovers the error state once a refresh succeeds again', async () => {
    const api = makeApi({
      getRuns: vi
        .fn()
        .mockResolvedValueOnce([makeRun({ id: 'run-1' })])
        .mockRejectedValueOnce(new TypeError('Failed to fetch'))
        .mockResolvedValueOnce([makeRun({ id: 'run-1' }), makeRun({ id: 'run-2' })]),
    });

    const { result } = renderHook(() => useRuns(api));
    await waitFor(() => expect(result.current.runs).toHaveLength(1));
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.error).not.toBeNull();

    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.error).toBeNull();
    expect(result.current.runs).toHaveLength(2);
  });

  it('distinguishes an empty-but-successful response from a failure', async () => {
    const api = makeApi({ getRuns: vi.fn().mockResolvedValue([]) });
    const { result } = renderHook(() => useRuns(api));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // The dashboard branches on exactly this: `runs-list-empty` is rendered when
    // there is no error and no runs, and `runs-list-error` when there is one.
    // Collapsing them would show "no execution evidence" for a network failure.
    expect(result.current.runs).toEqual([]);
    expect(result.current.error).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });

  it('reports a contract failure with the path rather than as a transport error', async () => {
    const { ResponseContractError } = await import('../lib/api.js');
    const api = makeApi({
      getRuns: vi
        .fn()
        .mockRejectedValue(
          new ResponseContractError(
            'Response from /api/v1/runs did not match the expected shape: 0.phase: Invalid input',
            '/api/v1/runs',
            200,
          ),
        ),
    });

    const { result } = renderHook(() => useRuns(api));
    await waitFor(() => expect(result.current.error).toBeInstanceOf(ResponseContractError));
    expect(result.current.error?.message).toContain('/api/v1/runs');
    expect(result.current.runs).toEqual([]);
  });

  it('does not throw past the hook for a non-Error rejection', async () => {
    const api: ApiClient = makeApi({
      getRuns: vi.fn().mockRejectedValue('the network said no'),
    });
    const { result } = renderHook(() => useRuns(api));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error?.message).toBe('Failed to fetch runs');
  });
});
