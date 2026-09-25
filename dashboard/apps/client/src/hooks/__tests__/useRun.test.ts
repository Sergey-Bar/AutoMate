import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const workspaceState: { activeWorkspaceId: string | null } = { activeWorkspaceId: null };

vi.mock('@/store/workspaceStore', () => {
  return {
    useWorkspaceStore: vi.fn((selector: (s: { activeWorkspaceId: string | null }) => unknown) =>
      selector({ activeWorkspaceId: workspaceState.activeWorkspaceId }),
    ),
  };
});

import {
  abortRun,
  startRun,
  useRun,
  useRunCompare,
  useRunFingerprints,
  useRuns,
  useRunTests,
  useTest,
} from '../useRun';

const mockFetch = vi.fn<typeof fetch>();
vi.stubGlobal('fetch', mockFetch);

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });

  return {
    queryClient,
    wrapper: ({ children }: { children: ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children),
  };
}

const runFixture = {
  id: 'run-1',
  startedAt: '2026-03-07T10:00:00.000Z',
  finishedAt: null,
  status: 'running' as const,
  total: 10,
  passed: 5,
  failed: 2,
  flaky: 1,
  skipped: 2,
  durationMs: null,
  branch: 'main',
  commitSha: 'abc123',
  commitMessage: 'msg',
  triggeredBy: 'ci',
  config: null,
  rawArgs: null,
};

const testFixture = {
  id: 'test-1',
  runId: 'run-1',
  suiteId: null,
  title: 'should pass',
  file: 'specs/example.spec.ts',
  line: 1,
  column: 1,
  status: 'passed' as const,
  durationMs: 100,
  tags: null,
  annotations: null,
  retryCount: 0,
  expectedStatus: 'passed',
  workerIndex: 0,
  stableId: 'stable-1',
};

const resultFixture = {
  id: 'result-1',
  testId: 'test-1',
  runId: 'run-1',
  retry: 0,
  status: 'passed' as const,
  durationMs: 100,
  startedAt: '2026-03-07T10:01:00.000Z',
  errorMessage: null,
  errorStack: null,
  workerIndex: 0,
  parallelIndex: 0,
  stdout: null,
  stderr: null,
  steps: null,
  attachments: null,
};

describe('useRun hooks', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    workspaceState.activeWorkspaceId = null;
  });

  it('useRuns fetches /api/runs when workspace is not active', async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify([runFixture]), { status: 200 }));

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useRuns(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockFetch).toHaveBeenCalledWith('/api/runs');
    expect(result.current.data).toEqual([runFixture]);
  });

  it('useRuns fetches /api/runs?workspaceId=X when workspace is active', async () => {
    workspaceState.activeWorkspaceId = 'ws-1';
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify([runFixture]), { status: 200 }));

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useRuns(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockFetch).toHaveBeenCalledWith('/api/runs?workspaceId=ws-1');
  });

  it('useRuns throws on non-ok response', async () => {
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 500 }));

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useRuns(), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toBe('Failed to fetch runs');
  });

  it('useRuns has refetchInterval of 10_000', async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify([runFixture]), { status: 200 }));
    const { queryClient, wrapper } = createWrapper();

    renderHook(() => useRuns(), { wrapper });

    await waitFor(() => {
      const query = queryClient.getQueryCache().find({ queryKey: ['runs', null] });
      expect(query?.options).toMatchObject({ refetchInterval: 10_000 });
    });
  });

  it('useRun fetches /api/runs/{runId} and parses RunSchema', async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify(runFixture), { status: 200 }));

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useRun('run-1'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockFetch).toHaveBeenCalledWith('/api/runs/run-1');
    expect(result.current.data).toEqual(runFixture);
  });

  it('useRun is disabled when runId is empty', async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useRun(''), { wrapper });

    await waitFor(() => expect(result.current.fetchStatus).toBe('idle'));
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('useRun throws on non-ok response', async () => {
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 404 }));

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useRun('missing'), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toBe('Run not found');
  });

  it('useRunTests fetches /api/runs/{runId}/tests and parses TestSchema[]', async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify([testFixture]), { status: 200 }));

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useRunTests('run-1'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockFetch).toHaveBeenCalledWith('/api/runs/run-1/tests');
    expect(result.current.data).toEqual([testFixture]);
  });

  it('useRunTests is disabled when runId is empty', async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useRunTests(''), { wrapper });

    await waitFor(() => expect(result.current.fetchStatus).toBe('idle'));
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('useTest fetches /api/runs/{runId}/tests/{testId} and returns merged test + results', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ ...testFixture, results: [resultFixture] }), { status: 200 }),
    );

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useTest('run-1', 'test-1'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockFetch).toHaveBeenCalledWith('/api/runs/run-1/tests/test-1');
    expect(result.current.data).toEqual({ ...testFixture, results: [resultFixture] });
  });

  it('useTest is disabled when runId is empty', async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useTest('', 'test-1'), { wrapper });

    await waitFor(() => expect(result.current.fetchStatus).toBe('idle'));
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('useTest is disabled when testId is empty', async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useTest('run-1', ''), { wrapper });

    await waitFor(() => expect(result.current.fetchStatus).toBe('idle'));
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('startRun posts to /api/runs and returns runId', async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ runId: 'run-new' }), { status: 200 }));

    const res = await startRun({ projects: ['chromium'] });

    expect(mockFetch).toHaveBeenCalledWith('/api/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projects: ['chromium'] }),
    });
    expect(res).toEqual({ runId: 'run-new' });
  });

  it('startRun throws on non-ok response', async () => {
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 500 }));

    await expect(startRun({})).rejects.toThrow('Failed to start run');
  });

  it('abortRun sends DELETE /api/runs/{runId}', async () => {
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 204 }));

    await abortRun('run-1');

    expect(mockFetch).toHaveBeenCalledWith('/api/runs/run-1', { method: 'DELETE' });
  });

  it('useRunFingerprints fetches fingerprint groups when enabled', async () => {
    const payload = [
      { fingerprint: 'fp-1', count: 2, errorMessage: 'err', testIds: ['test-1', 'test-2'] },
    ];
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify(payload), { status: 200 }));

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useRunFingerprints('run-1'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockFetch).toHaveBeenCalledWith('/api/runs/run-1/fingerprints');
    expect(result.current.data).toEqual(payload);
  });

  it('useRunFingerprints is disabled when runId is empty and has staleTime 30_000', async () => {
    const { queryClient, wrapper } = createWrapper();
    const { result } = renderHook(() => useRunFingerprints(''), { wrapper });

    await waitFor(() => {
      const query = queryClient.getQueryCache().find({ queryKey: ['run-fingerprints', ''] });
      expect(query?.options).toMatchObject({ staleTime: 30_000 });
    });
    expect(result.current.fetchStatus).toBe('idle');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('useRunCompare fetches /api/runs/compare?a=X&b=Y and parses rows', async () => {
    const compareRows = [
      {
        title: 'example',
        file: 'specs/example.spec.ts',
        statusA: 'passed',
        statusB: 'failed',
        durationA: 10,
        durationB: 20,
        changeType: 'regression' as const,
      },
    ];
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify(compareRows), { status: 200 }));

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useRunCompare('run-a', 'run-b'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockFetch).toHaveBeenCalledWith('/api/runs/compare?a=run-a&b=run-b');
    expect(result.current.data).toEqual(compareRows);
  });

  it('useRunCompare is disabled when either runId is null and has staleTime 60_000', async () => {
    const { queryClient, wrapper } = createWrapper();
    const { result } = renderHook(() => useRunCompare('run-a', null), { wrapper });

    await waitFor(() => {
      const query = queryClient.getQueryCache().find({ queryKey: ['run-compare', 'run-a', null] });
      expect(query?.options).toMatchObject({ staleTime: 60_000 });
    });
    expect(result.current.fetchStatus).toBe('idle');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('useRunTests throws when response is not ok', async () => {
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 500 }));
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useRunTests('run-1'), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toBe('Failed to fetch tests');
  });

  it('useTest throws when response is not ok', async () => {
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 404 }));
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useTest('run-1', 'test-1'), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toBe('Test not found');
  });

  it('useTest returns empty results array when results field is absent from response', async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify(testFixture), { status: 200 }));
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useTest('run-1', 'test-1'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.results).toEqual([]);
  });

  it('useRunFingerprints throws when response is not ok', async () => {
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 500 }));
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useRunFingerprints('run-1'), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toBe('Failed to fetch fingerprints');
  });

  it('useRunCompare throws when response is not ok', async () => {
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 500 }));
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useRunCompare('run-a', 'run-b'), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toBe('Failed to fetch comparison');
  });
});
