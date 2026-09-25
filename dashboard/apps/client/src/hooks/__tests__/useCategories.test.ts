import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useAssignCategory,
  useCategories,
  useFingerprintCategories,
} from '../useCategories';

const mockFetch = vi.fn<typeof fetch>();
vi.stubGlobal('fetch', mockFetch);

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

  return {
    queryClient,
    invalidateSpy,
    wrapper: ({ children }: { children: ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children),
  };
}

describe('useCategories hooks', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('useCategories fetches /api/categories and returns DefectCategory[]', async () => {
    const payload = [
      { id: 'cat-1', name: 'UI', color: '#ff0000' },
      { id: 'cat-2', name: 'Backend', color: '#00ff00' },
    ];
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify(payload), { status: 200 }));

    const { queryClient, wrapper } = createWrapper();
    const { result } = renderHook(() => useCategories(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockFetch).toHaveBeenCalledWith('/api/categories');
    expect(result.current.data).toEqual(payload);

    const query = queryClient.getQueryCache().find({ queryKey: ['categories'] });
    expect(query?.options).toMatchObject({ staleTime: 60_000 });
  });

  it('useFingerprintCategories fetches /api/fingerprint-categories and uses staleTime 30_000', async () => {
    const payload = [
      { fingerprint: 'fp-1', categoryId: 'cat-1' },
      { fingerprint: 'fp-2', categoryId: 'cat-2' },
    ];
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify(payload), { status: 200 }));

    const { queryClient, wrapper } = createWrapper();
    const { result } = renderHook(() => useFingerprintCategories(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockFetch).toHaveBeenCalledWith('/api/fingerprint-categories');
    expect(result.current.data).toEqual(payload);

    const query = queryClient.getQueryCache().find({ queryKey: ['fingerprint-categories'] });
    expect(query?.options).toMatchObject({ staleTime: 30_000 });
  });

  it('useAssignCategory sends PUT when categoryId is provided', async () => {
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 204 }));

    const { wrapper, invalidateSpy } = createWrapper();
    const { result } = renderHook(() => useAssignCategory(), { wrapper });

    await result.current.mutateAsync({ fingerprint: 'fp with space', categoryId: 'cat-9' });

    expect(mockFetch).toHaveBeenCalledWith('/api/fingerprint-categories/fp%20with%20space', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ categoryId: 'cat-9' }),
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['fingerprint-categories'] });
  });

  it('useAssignCategory sends DELETE when categoryId is null', async () => {
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 204 }));

    const { wrapper, invalidateSpy } = createWrapper();
    const { result } = renderHook(() => useAssignCategory(), { wrapper });

    await result.current.mutateAsync({ fingerprint: 'fp/1', categoryId: null });

    expect(mockFetch).toHaveBeenCalledWith('/api/fingerprint-categories/fp%2F1', { method: 'DELETE' });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['fingerprint-categories'] });
  });
});
