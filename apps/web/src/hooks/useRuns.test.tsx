/// <reference types="vitest/globals" />
import { renderHook, waitFor, act } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useRuns } from './useRuns.js';
import type { ApiClient, Run, RunUpdatedEvent } from '../lib/api.js';

function createApi(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    getRuns: vi.fn().mockResolvedValue([]),
    getRun: vi.fn(),
    getAnalyticsSummary: vi.fn(),
    getQuarantine: vi.fn(),
    addQuarantine: vi.fn(),
    onRunUpdated: vi.fn(() => () => undefined),
    getConversations: vi.fn(),
    createConversation: vi.fn(),
    sendMessage: vi.fn(),
    getMessages: vi.fn(),
    getModelConfig: vi.fn(),
    updateModelConfig: vi.fn(),
    getSuites: vi.fn().mockResolvedValue([]),
    getTests: vi.fn().mockResolvedValue([]),
    getConnectors: vi.fn().mockResolvedValue([]),
    getVaultSecrets: vi.fn().mockResolvedValue([]),
    deleteVaultSecret: vi.fn().mockResolvedValue(undefined),
    getA11yAudit: vi.fn().mockResolvedValue({ violations: [], pagesScanned: 0, scannedAt: '' }),
    ...overrides,
  };
}

function runUpdate(overrides: Partial<RunUpdatedEvent> = {}): RunUpdatedEvent {
  return {
    type: 'run:updated',
    version: '1',
    runId: 'run-1',
    status: 'passed',
    timestamp: '2026-05-06T00:00:00.000Z',
    ...overrides,
  };
}

describe('useRuns', () => {
  it('loads runs and subscribes to realtime updates for existing and new runs', async () => {
    let listener: ((event: RunUpdatedEvent) => void) | undefined;
    const unsubscribe = vi.fn();
    const api = createApi({
      getRuns: vi.fn().mockResolvedValue([
        { id: 'run-1', projectName: 'Web', status: 'running', startedAt: '2026-05-06T00:00:00.000Z' },
      ]),
      onRunUpdated: vi.fn((callback) => {
        listener = callback;
        return unsubscribe;
      }),
    });

    const { result, unmount } = renderHook(() => useRuns(api));

    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.runs).toEqual([
      { id: 'run-1', projectName: 'Web', status: 'running', startedAt: '2026-05-06T00:00:00.000Z' },
    ]);
    expect(result.current.error).toBeNull();

    act(() => listener?.(runUpdate({ runId: 'run-1', status: 'passed' })));
    expect(result.current.runs[0]).toMatchObject({ id: 'run-1', status: 'passed', projectName: 'Web' });

    act(() => listener?.(runUpdate({ runId: 'run-2', status: 'failed', timestamp: '2026-05-06T00:02:00.000Z' })));
    expect(result.current.runs[0]).toMatchObject({
      id: 'run-2',
      projectName: 'Unknown Project',
      status: 'failed',
      startedAt: '2026-05-06T00:02:00.000Z',
    });

    unmount();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('surfaces fetch errors and keeps realtime cleanup intact', async () => {
    const unsubscribe = vi.fn();
    const api = createApi({
      getRuns: vi.fn().mockRejectedValue(new Error('network down')),
      onRunUpdated: vi.fn(() => unsubscribe),
    });

    const { result, unmount } = renderHook(() => useRuns(api));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.runs).toEqual([]);
    expect(result.current.error?.message).toBe('network down');

    unmount();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('does not update state after unmount when the initial fetch resolves late', async () => {
    let resolveRuns: (runs: Run[]) => void = () => undefined;
    const api = createApi({
      getRuns: vi.fn((): Promise<Run[]> => new Promise((resolve) => { resolveRuns = resolve; })),
    });

    const { result, unmount } = renderHook(() => useRuns(api));
    expect(result.current.isLoading).toBe(true);

    unmount();

    await act(async () => {
      resolveRuns([{ id: 'late-run', status: 'passed', startedAt: '2026-05-06T00:00:00.000Z' }]);
      await Promise.resolve();
    });

    expect(api.getRuns).toHaveBeenCalledOnce();
  });
});
