/// <reference types="vitest/globals" />
import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useRun, useSuites, useTests } from './useDashboardPages.js';
import type { ApiClient, Run, Suite, Test } from '../lib/api.js';

function createApi(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    getRuns: vi.fn().mockResolvedValue([]),
    getRun: vi.fn().mockResolvedValue(null),
    getSuites: vi.fn().mockResolvedValue([]),
    getTests: vi.fn().mockResolvedValue([]),
    getAnalyticsSummary: vi.fn(),
    getQuarantine: vi.fn(),
    addQuarantine: vi.fn(),
    onRunUpdated: vi.fn(() => () => undefined),
    getConversations: vi.fn().mockResolvedValue([]),
    createConversation: vi.fn(),
    sendMessage: vi.fn(),
    getMessages: vi.fn().mockResolvedValue([]),
    getModelConfig: vi.fn(),
    updateModelConfig: vi.fn(),
    getConnectors: vi.fn().mockResolvedValue([]),
    getVaultSecrets: vi.fn().mockResolvedValue([]),
    deleteVaultSecret: vi.fn().mockResolvedValue(undefined),
    getA11yAudit: vi.fn().mockResolvedValue({ violations: [], pagesScanned: 0, scannedAt: '' }),
    ...overrides,
  };
}

const sampleRun: Run = {
  id: 'run-1',
  projectName: 'web',
  status: 'passed',
  startedAt: '2026-06-01T00:00:00.000Z',
  durationMs: 5000,
  total: 10,
  passed: 10,
  failed: 0,
};

const sampleSuites: Suite[] = [
  { id: 'suite-1', name: 'Auth Suite', projectName: 'web', totalRuns: 5, passRate: 100 },
  { id: 'suite-2', name: 'Checkout Suite', projectName: 'web', totalRuns: 3, passRate: 66.7 },
];

const sampleTests: Test[] = [
  { id: 'test-1', title: 'Login works', file: 'auth.spec.ts', status: 'passed', durationMs: 300 },
  { id: 'test-2', title: 'Signup works', file: 'auth.spec.ts', status: 'failed', durationMs: 100 },
];

describe('useRun', () => {
  it('starts with isLoading=true and data=null', () => {
    const api = createApi({ getRun: vi.fn(() => new Promise<Run>(() => {})) });
    const { result } = renderHook(() => useRun('run-1', api));
    expect(result.current.isLoading).toBe(true);
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('fetches run data on success', async () => {
    const api = createApi({ getRun: vi.fn().mockResolvedValue(sampleRun) });
    const { result } = renderHook(() => useRun('run-1', api));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(api.getRun).toHaveBeenCalledWith('run-1');
    expect(result.current.data).toEqual(sampleRun);
    expect(result.current.error).toBeNull();
  });

  it('sets error when getRun rejects', async () => {
    const api = createApi({ getRun: vi.fn().mockRejectedValue(new Error('run not found')) });
    const { result } = renderHook(() => useRun('run-1', api));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error?.message).toBe('run not found');
    expect(result.current.data).toBeNull();
  });

  it('re-fetches when run id changes', async () => {
    const run1 = { ...sampleRun, id: 'run-1' };
    const run2 = { ...sampleRun, id: 'run-2', status: 'failed' };
    const api = createApi({
      getRun: vi.fn()
        .mockResolvedValueOnce(run1)
        .mockResolvedValueOnce(run2),
    });

    const { result, rerender } = renderHook(
      ({ id }) => useRun(id, api),
      { initialProps: { id: 'run-1' } },
    );

    await waitFor(() => expect(result.current.data?.id).toBe('run-1'));

    rerender({ id: 'run-2' });

    await waitFor(() => expect(result.current.data?.id).toBe('run-2'));
    expect(api.getRun).toHaveBeenCalledWith('run-2');
  });

  it('does not update state after unmount', async () => {
    let resolve: (r: Run) => void = () => {};
    const api = createApi({
      getRun: vi.fn(() => new Promise<Run>((res) => { resolve = res; })),
    });
    const { result, unmount } = renderHook(() => useRun('run-1', api));

    unmount();
    resolve(sampleRun);
    await Promise.resolve();

    expect(result.current.data).toBeNull();
    expect(result.current.isLoading).toBe(true);
  });
});

describe('useSuites', () => {
  it('starts with isLoading=true and empty data', () => {
    const api = createApi({ getSuites: vi.fn(() => new Promise<Suite[]>(() => {})) });
    const { result } = renderHook(() => useSuites(api));
    expect(result.current.isLoading).toBe(true);
    expect(result.current.data).toEqual([]);
  });

  it('loads suites on success', async () => {
    const api = createApi({ getSuites: vi.fn().mockResolvedValue(sampleSuites) });
    const { result } = renderHook(() => useSuites(api));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.data).toEqual(sampleSuites);
    expect(result.current.error).toBeNull();
  });

  it('returns empty array when API returns []', async () => {
    const api = createApi({ getSuites: vi.fn().mockResolvedValue([]) });
    const { result } = renderHook(() => useSuites(api));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.data).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it('sets error when getSuites rejects', async () => {
    const api = createApi({ getSuites: vi.fn().mockRejectedValue(new Error('suites error')) });
    const { result } = renderHook(() => useSuites(api));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error?.message).toBe('suites error');
    expect(result.current.data).toEqual([]);
  });

  it('does not update state after unmount', async () => {
    let resolve: (s: Suite[]) => void = () => {};
    const api = createApi({
      getSuites: vi.fn(() => new Promise<Suite[]>((res) => { resolve = res; })),
    });
    const { result, unmount } = renderHook(() => useSuites(api));

    unmount();
    resolve(sampleSuites);
    await Promise.resolve();

    expect(result.current.data).toEqual([]);
  });
});

describe('useTests', () => {
  it('starts with isLoading=true and empty data', () => {
    const api = createApi({ getTests: vi.fn(() => new Promise<Test[]>(() => {})) });
    const { result } = renderHook(() => useTests(api));
    expect(result.current.isLoading).toBe(true);
    expect(result.current.data).toEqual([]);
  });

  it('loads tests on success', async () => {
    const api = createApi({ getTests: vi.fn().mockResolvedValue(sampleTests) });
    const { result } = renderHook(() => useTests(api));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.data).toEqual(sampleTests);
    expect(result.current.error).toBeNull();
  });

  it('returns empty array when API returns []', async () => {
    const api = createApi({ getTests: vi.fn().mockResolvedValue([]) });
    const { result } = renderHook(() => useTests(api));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.data).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it('sets error when getTests rejects', async () => {
    const api = createApi({ getTests: vi.fn().mockRejectedValue(new Error('tests error')) });
    const { result } = renderHook(() => useTests(api));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error?.message).toBe('tests error');
    expect(result.current.data).toEqual([]);
  });

  it('does not update state after unmount', async () => {
    let resolve: (t: Test[]) => void = () => {};
    const api = createApi({
      getTests: vi.fn(() => new Promise<Test[]>((res) => { resolve = res; })),
    });
    const { result, unmount } = renderHook(() => useTests(api));

    unmount();
    resolve(sampleTests);
    await Promise.resolve();

    expect(result.current.data).toEqual([]);
  });
});
