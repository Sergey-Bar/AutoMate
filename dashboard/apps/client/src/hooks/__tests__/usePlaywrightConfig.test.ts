import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { toastPromiseMock } = vi.hoisted(() => ({
  toastPromiseMock: vi.fn(<T>(promise: Promise<T>) => promise),
}));

vi.mock('sonner', () => ({
  toast: {
    promise: toastPromiseMock,
  },
}));

import { usePlaywrightConfig } from '../usePlaywrightConfig';

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

describe('usePlaywrightConfig', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    toastPromiseMock.mockReset();
    toastPromiseMock.mockImplementation(<T>(promise: Promise<T>) => promise);
  });

  it('fetches /api/config when no path is provided', async () => {
    const payload = { path: 'playwright.config.ts', content: 'export default {}' };
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify(payload), { status: 200 }));

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => usePlaywrightConfig(), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(mockFetch).toHaveBeenCalledWith('/api/config');
    expect(result.current.config).toEqual(payload);
    expect(result.current.error).toBeNull();
  });

  it('fetches /api/config?path=X when path is provided', async () => {
    const payload = { path: 'configs/pw.config.ts', content: 'export default {}' };
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify(payload), { status: 200 }));

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => usePlaywrightConfig('configs/pw.config.ts'), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(mockFetch).toHaveBeenCalledWith('/api/config?path=configs%2Fpw.config.ts');
    expect(result.current.config).toEqual(payload);
  });

  it('exposes error when config fetch is non-ok', async () => {
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 500 }));

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => usePlaywrightConfig(), { wrapper });

    await waitFor(() => expect(result.current.error).toBeTruthy());

    expect((result.current.error as Error).message).toBe('Could not load playwright config');
  });

  it('save uses PUT with content and wraps mutateAsync in toast.promise', async () => {
    const payload = { path: 'playwright.config.ts', content: 'old content' };
    mockFetch
      .mockResolvedValueOnce(new Response(JSON.stringify(payload), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => usePlaywrightConfig(), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await result.current.save('new content');

    expect(mockFetch).toHaveBeenNthCalledWith(2, '/api/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'new content' }),
    });

    expect(toastPromiseMock).toHaveBeenCalledTimes(1);
    expect(toastPromiseMock).toHaveBeenCalledWith(
      expect.any(Promise),
      expect.objectContaining({
        loading: 'Saving config…',
        success: 'Config saved',
        error: 'Failed to save config',
      }),
    );
  });

  it('save invalidates playwright-config query key on success', async () => {
    const payload = { path: 'playwright.config.ts', content: 'old content' };
    mockFetch
      .mockResolvedValueOnce(new Response(JSON.stringify(payload), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    const { wrapper, invalidateSpy } = createWrapper();
    const { result } = renderHook(() => usePlaywrightConfig(), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await result.current.save('new content');

    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['playwright-config'] });
    });
  });

  it('save falls back to "Save failed" when error response body has no error field (covers ?? fallback branch)', async () => {
    const payload = { path: 'playwright.config.ts', content: 'old' };
    mockFetch
      .mockResolvedValueOnce(new Response(JSON.stringify(payload), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: 'something went wrong' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => usePlaywrightConfig(), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await expect(result.current.save('content')).rejects.toThrow('Save failed');
  });

  it('save throws parsed backend error on non-ok response', async () => {
    const payload = { path: 'playwright.config.ts', content: 'old content' };
    mockFetch
      .mockResolvedValueOnce(new Response(JSON.stringify(payload), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'Write denied' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => usePlaywrightConfig(), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await expect(result.current.save('blocked')).rejects.toThrow('Write denied');
  });
});
