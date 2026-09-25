import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
type WsEvent = { type: string; runId: string; payload: unknown };

const { wsStore, runStore, useWsStoreMock } = vi.hoisted(() => {
  const wsStoreInner = {
    connect: vi.fn<(runId?: string) => void>(),
    subscribe: vi.fn<(type: string, handler: (event: WsEvent) => void) => () => void>(),
    disconnect: vi.fn<() => void>(),
    connectionState: 'connected' as const,
  };

  const runStoreInner = {
    applyRunStart: vi.fn<(payload: unknown) => void>(),
    applyTestBegin: vi.fn<(payload: unknown) => void>(),
    applyTestEnd: vi.fn<(testId: string, payload: unknown) => void>(),
    appendTerminal: vi.fn<(chunk: string) => void>(),
    applyRunEnd: vi.fn<(payload: unknown) => void>(),
    setActiveRun: vi.fn<(runId: string | null) => void>(),
  };

  const useWsStoreMockInner = Object.assign(
    vi.fn((selector: (s: typeof wsStoreInner) => unknown) => selector(wsStoreInner)),
    {
      getState: vi.fn(() => ({ disconnect: wsStoreInner.disconnect })),
    },
  );

  return { wsStore: wsStoreInner, runStore: runStoreInner, useWsStoreMock: useWsStoreMockInner };
});

vi.mock('@/store/wsStore', () => ({
  useWsStore: useWsStoreMock,
}));

vi.mock('@/store/runStore', () => ({
  useRunStore: vi.fn((selector: (s: typeof runStore) => unknown) => selector(runStore)),
}));

import { useLiveRun } from '../useLiveRun';

describe('useLiveRun', () => {
  beforeEach(() => {
    wsStore.connect.mockReset();
    wsStore.subscribe.mockReset();
    wsStore.disconnect.mockReset();
    runStore.applyRunStart.mockReset();
    runStore.applyTestBegin.mockReset();
    runStore.applyTestEnd.mockReset();
    runStore.appendTerminal.mockReset();
    runStore.applyRunEnd.mockReset();
    runStore.setActiveRun.mockReset();
    useWsStoreMock.getState.mockClear();
  });

  it('connects and sets active run on mount, returns connectionState', async () => {
    const unsubs = [vi.fn(), vi.fn(), vi.fn(), vi.fn(), vi.fn(), vi.fn()];
    wsStore.subscribe
      .mockReturnValueOnce(unsubs[0])
      .mockReturnValueOnce(unsubs[1])
      .mockReturnValueOnce(unsubs[2])
      .mockReturnValueOnce(unsubs[3])
      .mockReturnValueOnce(unsubs[4])
      .mockReturnValueOnce(unsubs[5]);

    const { result } = renderHook(() => useLiveRun('run-1'));

    await waitFor(() => {
      expect(runStore.setActiveRun).toHaveBeenCalledWith('run-1');
      expect(wsStore.connect).toHaveBeenCalledWith('run-1');
    });

    expect(result.current).toEqual({ connectionState: 'connected' });
    expect(wsStore.subscribe).toHaveBeenCalledTimes(6);
    expect(wsStore.subscribe.mock.calls.map((c) => c[0])).toEqual([
      'run:start',
      'test:begin',
      'test:end',
      'stdout',
      'stderr',
      'run:end',
    ]);
  });

  it('pipes matching run events into runStore actions', async () => {
    const handlers = new Map<string, (event: WsEvent) => void>();
    wsStore.subscribe.mockImplementation((type, handler) => {
      handlers.set(type, handler);
      return vi.fn();
    });

    renderHook(() => useLiveRun('run-1'));

    await waitFor(() => expect(wsStore.subscribe).toHaveBeenCalledTimes(6));

    handlers.get('run:start')?.({ type: 'run:start', runId: 'run-1', payload: { id: 'run-1' } });
    handlers.get('test:begin')?.({ type: 'test:begin', runId: 'run-1', payload: { id: 't-1' } });
    handlers.get('test:end')?.({
      type: 'test:end',
      runId: 'run-1',
      payload: { testId: 't-1', status: 'passed' },
    });
    handlers.get('stdout')?.({ type: 'stdout', runId: 'run-1', payload: { chunk: 'out' } });
    handlers.get('stderr')?.({ type: 'stderr', runId: 'run-1', payload: { chunk: 'err' } });
    handlers.get('run:end')?.({ type: 'run:end', runId: 'run-1', payload: { status: 'passed' } });

    expect(runStore.applyRunStart).toHaveBeenCalledWith({ id: 'run-1' });
    expect(runStore.applyTestBegin).toHaveBeenCalledWith({ id: 't-1' });
    expect(runStore.applyTestEnd).toHaveBeenCalledWith('t-1', { testId: 't-1', status: 'passed' });
    expect(runStore.appendTerminal).toHaveBeenNthCalledWith(1, 'out');
    expect(runStore.appendTerminal).toHaveBeenNthCalledWith(2, 'err');
    expect(runStore.applyRunEnd).toHaveBeenCalledWith({ status: 'passed' });
  });

  it('filters out events from other runIds', async () => {
    const handlers = new Map<string, (event: WsEvent) => void>();
    wsStore.subscribe.mockImplementation((type, handler) => {
      handlers.set(type, handler);
      return vi.fn();
    });

    renderHook(() => useLiveRun('run-1'));
    await waitFor(() => expect(wsStore.subscribe).toHaveBeenCalledTimes(6));

    handlers.get('run:start')?.({ type: 'run:start', runId: 'run-2', payload: { id: 'run-2' } });
    handlers.get('test:begin')?.({ type: 'test:begin', runId: 'run-2', payload: { id: 't-2' } });
    handlers.get('test:end')?.({ type: 'test:end', runId: 'run-2', payload: { testId: 't-2' } });
    handlers.get('stdout')?.({ type: 'stdout', runId: 'run-2', payload: { chunk: 'out' } });
    handlers.get('stderr')?.({ type: 'stderr', runId: 'run-2', payload: { chunk: 'err' } });
    handlers.get('run:end')?.({ type: 'run:end', runId: 'run-2', payload: { status: 'failed' } });

    expect(runStore.applyRunStart).not.toHaveBeenCalled();
    expect(runStore.applyTestBegin).not.toHaveBeenCalled();
    expect(runStore.applyTestEnd).not.toHaveBeenCalled();
    expect(runStore.appendTerminal).not.toHaveBeenCalled();
    expect(runStore.applyRunEnd).not.toHaveBeenCalled();
  });

  it('unsubscribes all handlers and disconnects on unmount', async () => {
    const unsubs = [vi.fn(), vi.fn(), vi.fn(), vi.fn(), vi.fn(), vi.fn()];
    wsStore.subscribe
      .mockReturnValueOnce(unsubs[0])
      .mockReturnValueOnce(unsubs[1])
      .mockReturnValueOnce(unsubs[2])
      .mockReturnValueOnce(unsubs[3])
      .mockReturnValueOnce(unsubs[4])
      .mockReturnValueOnce(unsubs[5]);

    const { unmount } = renderHook(() => useLiveRun('run-1'));

    await waitFor(() => expect(wsStore.subscribe).toHaveBeenCalledTimes(6));
    unmount();

    for (const unsub of unsubs) {
      expect(unsub).toHaveBeenCalledTimes(1);
    }
    expect(useWsStoreMock.getState).toHaveBeenCalledTimes(1);
    expect(wsStore.disconnect).toHaveBeenCalledTimes(1);
  });

  it('does nothing when runId is empty', async () => {
    renderHook(() => useLiveRun(''));

    await waitFor(() => {
      expect(runStore.setActiveRun).not.toHaveBeenCalled();
      expect(wsStore.connect).not.toHaveBeenCalled();
      expect(wsStore.subscribe).not.toHaveBeenCalled();
    });
  });
});
