/// <reference types="vitest/globals" />
import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { useFlakyTests } from './useFlakyTests.js';
import type { FlakyTest } from '../services/flaky-detection.js';

const mockFetch = vi.fn();

beforeEach(() => {
  globalThis.fetch = mockFetch;
  vi.resetAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const sampleFlakyTests: FlakyTest[] = [
  {
    testId: 'test-1',
    testName: 'Login flow',
    suiteName: 'Auth Suite',
    flakinessScore: 0.6,
    recentResults: ['passed', 'failed', 'passed', 'failed'],
  },
  {
    testId: 'test-2',
    testName: 'Checkout flow',
    suiteName: 'E-commerce Suite',
    flakinessScore: 0.4,
    recentResults: ['passed', 'failed', 'passed'],
  },
];

describe('useFlakyTests', () => {
  it('starts with isLoading=true and empty data', () => {
    const fetchFn = vi.fn(() => new Promise<FlakyTest[]>(() => {}));
    const { result } = renderHook(() => useFlakyTests(fetchFn));
    expect(result.current.isLoading).toBe(true);
    expect(result.current.data).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it('loads data via custom fetchFn on success', async () => {
    const fetchFn = vi.fn().mockResolvedValue(sampleFlakyTests);
    const { result } = renderHook(() => useFlakyTests(fetchFn));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.data).toEqual(sampleFlakyTests);
    expect(result.current.error).toBeNull();
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it('returns empty array when custom fetchFn resolves empty list', async () => {
    const fetchFn = vi.fn().mockResolvedValue([]);
    const { result } = renderHook(() => useFlakyTests(fetchFn));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.data).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it('sets error when custom fetchFn rejects', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error('network failure'));
    const { result } = renderHook(() => useFlakyTests(fetchFn));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error?.message).toBe('network failure');
    expect(result.current.data).toEqual([]);
  });

  it('fetches from /api/observability/flaky when no fetchFn provided', async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify(sampleFlakyTests), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const { result } = renderHook(() => useFlakyTests());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(mockFetch).toHaveBeenCalledWith('/api/observability/flaky');
    expect(result.current.data).toEqual(sampleFlakyTests);
    expect(result.current.error).toBeNull();
  });

  it('sets error when default fetch returns non-ok response', async () => {
    mockFetch.mockResolvedValue(new Response('Server Error', { status: 500 }));

    const { result } = renderHook(() => useFlakyTests());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error?.message).toBe('Failed to fetch flaky tests');
    expect(result.current.data).toEqual([]);
  });

  it('sets error when default fetch network rejects', async () => {
    mockFetch.mockRejectedValue(new Error('network down'));

    const { result } = renderHook(() => useFlakyTests());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error?.message).toBe('network down');
    expect(result.current.data).toEqual([]);
  });

  it('sets error when Zod schema parse fails on malformed JSON', async () => {
    // Items missing required fields — Zod will throw
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify([{ invalid: 'data' }]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const { result } = renderHook(() => useFlakyTests());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.data).toEqual([]);
  });

  it('does not update state after unmount (cancelled branch)', async () => {
    let resolve: (v: FlakyTest[]) => void = () => {};
    const fetchFn = vi.fn(
      () => new Promise<FlakyTest[]>((res) => { resolve = res; }),
    );

    const { result, unmount } = renderHook(() => useFlakyTests(fetchFn));
    expect(result.current.isLoading).toBe(true);

    unmount();

    // Resolve after unmount — state must remain untouched
    resolve(sampleFlakyTests);
    await Promise.resolve();

    expect(result.current.data).toEqual([]);
    expect(result.current.isLoading).toBe(true); // never updated
  });
});
