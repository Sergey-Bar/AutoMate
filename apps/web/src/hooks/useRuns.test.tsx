import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { RunEventEnvelope } from '@automate/shared-contracts';
import { isRunActive, useRuns } from './useRuns.js';
import { makeApi, makePhaseEvent, makeRun } from '../test-utils.js';
import type { RunEventSubscription } from '../lib/api.js';

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
