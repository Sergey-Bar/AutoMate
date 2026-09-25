/// <reference types="vitest/globals" />
import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useTrace } from './useTrace.js';
import type { Trace } from './useTrace.js';

function okJson(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

const sampleTrace: Trace = {
  id: 'trace-1',
  testName: 'Login button works',
  status: 'passed',
  durationMs: 1200,
  startedAt: '2026-06-01T10:00:00.000Z',
  traceUrl: 'https://traces.example.com/trace-1',
  actions: [
    { type: 'click', title: 'Click login', durationMs: 300 },
    { type: 'assert', title: 'Check heading', durationMs: null },
  ],
  networkRequests: [
    { method: 'POST', url: '/api/auth/login', status: 200 },
    { method: 'GET', url: '/api/user', status: null },
  ],
  consoleLogs: [{ level: 'info', message: 'Page loaded' }],
};

describe('useTrace', () => {
  it('starts with isLoading=true, data=null, error=null', () => {
    const fetchFn = vi.fn(() => new Promise<Response>(() => {}));
    const { result } = renderHook(() => useTrace('trace-1', fetchFn));
    expect(result.current.isLoading).toBe(true);
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('fetches and parses trace data on success', async () => {
    const fetchFn = vi.fn().mockResolvedValue(okJson(sampleTrace));
    const { result } = renderHook(() => useTrace('trace-1', fetchFn));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(fetchFn).toHaveBeenCalledWith('/api/traces/trace-1');
    expect(result.current.data).toEqual(sampleTrace);
    expect(result.current.error).toBeNull();
  });

  it('handles trace with minimal required fields (optional fields absent)', async () => {
    const minimal: Trace = {
      id: 'trace-min',
      testName: 'Minimal test',
      status: 'failed',
      startedAt: '2026-06-01T00:00:00.000Z',
    };
    const fetchFn = vi.fn().mockResolvedValue(okJson(minimal));
    const { result } = renderHook(() => useTrace('trace-min', fetchFn));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.data?.id).toBe('trace-min');
    expect(result.current.data?.traceUrl).toBeUndefined();
    expect(result.current.data?.actions).toBeUndefined();
  });

  it('sets error "Trace not found" on 404 response', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('Not Found', { status: 404 }));
    const { result } = renderHook(() => useTrace('trace-missing', fetchFn));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error?.message).toBe('Trace not found');
    expect(result.current.data).toBeNull();
  });

  it('sets error "Failed to fetch trace" on other non-ok response', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('Server Error', { status: 500 }));
    const { result } = renderHook(() => useTrace('trace-1', fetchFn));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error?.message).toBe('Failed to fetch trace');
    expect(result.current.data).toBeNull();
  });

  it('sets error on network rejection', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error('network timeout'));
    const { result } = renderHook(() => useTrace('trace-1', fetchFn));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error?.message).toBe('network timeout');
    expect(result.current.data).toBeNull();
  });

  it('sets error when response JSON fails Zod schema validation', async () => {
    // Missing required 'id', 'testName', 'status', 'startedAt'
    const fetchFn = vi.fn().mockResolvedValue(okJson({ invalid: 'data' }));
    const { result } = renderHook(() => useTrace('trace-1', fetchFn));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.data).toBeNull();
  });

  it('re-fetches when traceId changes', async () => {
    const fetchFn = vi.fn().mockResolvedValue(okJson(sampleTrace));
    const { result, rerender } = renderHook(
      ({ id }) => useTrace(id, fetchFn),
      { initialProps: { id: 'trace-1' } },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(fetchFn).toHaveBeenCalledWith('/api/traces/trace-1');

    const trace2 = { ...sampleTrace, id: 'trace-2', testName: 'Second test' };
    fetchFn.mockResolvedValue(okJson(trace2));

    rerender({ id: 'trace-2' });

    await waitFor(() => expect(result.current.data?.id).toBe('trace-2'));
    expect(fetchFn).toHaveBeenCalledWith('/api/traces/trace-2');
  });

  it('does not update state after unmount', async () => {
    let resolve: (r: Response) => void = () => {};
    const fetchFn = vi.fn(() => new Promise<Response>((res) => { resolve = res; }));

    const { result, unmount } = renderHook(() => useTrace('trace-1', fetchFn));
    expect(result.current.isLoading).toBe(true);

    unmount();
    resolve(okJson(sampleTrace));
    await Promise.resolve();

    expect(result.current.data).toBeNull();
    expect(result.current.isLoading).toBe(true); // never flipped after unmount
  });
});
