/// <reference types="vitest/globals" />
import { renderHook, waitFor, act } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useAnalytics, useQuarantine, useRunDetail } from './useDashboard.js';
import type { ApiClient } from '../lib/api.js';

function createApi(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    getRuns: vi.fn(),
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

describe('dashboard hooks', () => {
  it('useAnalytics loads summary data and exposes fetch errors', async () => {
    const successApi = createApi({
      getAnalyticsSummary: vi.fn().mockResolvedValue({ totalRuns: 3, passRate: 66.7, avgDurationMs: 1200 }),
    });

    const success = renderHook(() => useAnalytics(successApi));
    await waitFor(() => expect(success.result.current.isLoading).toBe(false));

    expect(success.result.current.data).toEqual({ totalRuns: 3, passRate: 66.7, avgDurationMs: 1200 });
    expect(success.result.current.error).toBeNull();
    success.unmount();

    const failureApi = createApi({
      getAnalyticsSummary: vi.fn().mockRejectedValue(new Error('analytics unavailable')),
    });

    const failure = renderHook(() => useAnalytics(failureApi));
    await waitFor(() => expect(failure.result.current.isLoading).toBe(false));

    expect(failure.result.current.data).toBeNull();
    expect(failure.result.current.error?.message).toBe('analytics unavailable');
    failure.unmount();
  });

  it('useRunDetail refetches when the run id changes', async () => {
    const api = createApi({
      getRun: vi.fn(async (id: string) => ({ id, status: 'running', startedAt: '2026-05-06T00:00:00.000Z' })),
    });

    const { result, rerender } = renderHook(({ id }) => useRunDetail(id, api), {
      initialProps: { id: 'run-a' },
    });

    await waitFor(() => expect(result.current.data?.id).toBe('run-a'));

    rerender({ id: 'run-b' });

    await waitFor(() => expect(result.current.data?.id).toBe('run-b'));
    expect(api.getRun).toHaveBeenCalledWith('run-a');
    expect(api.getRun).toHaveBeenCalledWith('run-b');
  });

  it('useQuarantine loads entries and appends newly created quarantine records', async () => {
    const api = createApi({
      getQuarantine: vi.fn().mockResolvedValue([
        {
          id: 'q-1',
          testTitle: 'existing',
          testFile: 'tests/existing.spec.ts',
          reason: null,
          quarantinedAt: '2026-05-06T00:00:00.000Z',
        },
      ]),
      addQuarantine: vi.fn().mockResolvedValue({
        id: 'q-2',
        testTitle: 'new flaky test',
        testFile: 'tests/new.spec.ts',
        reason: 'intermittent timeout',
        quarantinedAt: '2026-05-06T00:01:00.000Z',
      }),
    });

    const { result } = renderHook(() => useQuarantine(api));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toHaveLength(1);

    await act(async () => {
      await result.current.addQuarantine({
        testTitle: 'new flaky test',
        testFile: 'tests/new.spec.ts',
        reason: 'intermittent timeout',
      });
    });

    expect(api.addQuarantine).toHaveBeenCalledWith({
      testTitle: 'new flaky test',
      testFile: 'tests/new.spec.ts',
      reason: 'intermittent timeout',
    });
    expect(result.current.data.map((entry) => entry.id)).toEqual(['q-1', 'q-2']);
  });

  it('useRunDetail surfaces fetch errors', async () => {
    const api = createApi({
      getRun: vi.fn().mockRejectedValue(new Error('run not found')),
    });

    const { result } = renderHook(() => useRunDetail('run-missing', api));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error?.message).toBe('run not found');
    expect(result.current.data).toBeNull();
  });

  it('useRunDetail does not update state after unmount', async () => {
    let resolve: (r: { id: string; status: string; startedAt: string }) => void = () => {};
    const api = createApi({
      getRun: vi.fn(
        () => new Promise<{ id: string; status: string; startedAt: string }>((res) => { resolve = res; }),
      ),
    });

    const { result, unmount } = renderHook(() => useRunDetail('run-1', api));
    unmount();
    resolve({ id: 'run-1', status: 'passed', startedAt: '2026-05-06T00:00:00.000Z' });
    await Promise.resolve();

    expect(result.current.data).toBeNull();
  });

  it('useQuarantine surfaces initial load errors', async () => {
    const api = createApi({
      getQuarantine: vi.fn().mockRejectedValue(new Error('quarantine unavailable')),
    });

    const { result } = renderHook(() => useQuarantine(api));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error?.message).toBe('quarantine unavailable');
    expect(result.current.data).toEqual([]);
  });

  it('useAnalytics does not update state after unmount', async () => {
    let resolve: (v: { totalRuns: number; passRate: number; avgDurationMs: number | null }) => void = () => {};
    const api = createApi({
      getAnalyticsSummary: vi.fn(
        () =>
          new Promise<{ totalRuns: number; passRate: number; avgDurationMs: number | null }>((res) => {
            resolve = res;
          }),
      ),
    });

    const { result, unmount } = renderHook(() => useAnalytics(api));
    unmount();
    resolve({ totalRuns: 1, passRate: 100, avgDurationMs: null });
    await Promise.resolve();

    expect(result.current.data).toBeNull();
  });

  it('useQuarantine does not update state after unmount', async () => {
    let resolve: (v: import('../lib/api.js').QuarantineEntry[]) => void = () => {};
    const api = createApi({
      getQuarantine: vi.fn(
        () => new Promise<import('../lib/api.js').QuarantineEntry[]>((res) => { resolve = res; }),
      ),
    });
    const { result, unmount } = renderHook(() => useQuarantine(api));
    unmount();
    resolve([]);
    await Promise.resolve();

    expect(result.current.data).toEqual([]);
    expect(result.current.isLoading).toBe(true);
  });
});
