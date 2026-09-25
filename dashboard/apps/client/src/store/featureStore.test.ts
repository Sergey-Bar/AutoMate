import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

// Mock fetch before importing the store
const mockFlags = {
  'live-run-monitoring': true,
  'auto-quarantine': false,
  'ai-explain': false,
};

global.fetch = vi.fn(() =>
  Promise.resolve({
    ok: true,
    json: () => Promise.resolve(mockFlags),
  } as Response),
);

describe('featureStore', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('exports useFeatureStore and useFeature', async () => {
    const mod = await import('./featureStore.js');
    expect(mod.useFeatureStore).toBeDefined();
    expect(mod.useFeature).toBeDefined();
  });

  it('useFeature returns false for disabled flags', async () => {
    const { useFeature } = await import('./featureStore.js');
    // Trigger fetch
    const { useFeatureStore } = await import('./featureStore.js');
    useFeatureStore.getState().fetchFlags();

    await waitFor(() => {
      expect(useFeatureStore.getState().loaded).toBe(true);
    });

    const { result } = renderHook(() => useFeature('auto-quarantine'));
    expect(result.current).toBe(false);
  });

  it('useFeature returns true for enabled flags', async () => {
    const { useFeature, useFeatureStore } = await import('./featureStore.js');
    useFeatureStore.getState().fetchFlags();

    await waitFor(() => {
      expect(useFeatureStore.getState().loaded).toBe(true);
    });

    const { result } = renderHook(() => useFeature('live-run-monitoring'));
    expect(result.current).toBe(true);
  });

  it('sets error state when fetch returns non-ok response', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 503,
      json: () => Promise.resolve({}),
    } as Response);

    const { useFeatureStore } = await import('./featureStore.js');
    await useFeatureStore.getState().fetchFlags();

    await waitFor(() => {
      expect(useFeatureStore.getState().loaded).toBe(true);
    });

    expect(useFeatureStore.getState().error).toBe('HTTP 503');
  });

  it('sets error when fetch throws', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Network down'));

    const { useFeatureStore } = await import('./featureStore.js');
    await useFeatureStore.getState().fetchFlags();

    await waitFor(() => {
      expect(useFeatureStore.getState().loaded).toBe(true);
    });

    expect(useFeatureStore.getState().error).toBe('Network down');
  });

  it('skips fetch when flags already loaded', async () => {
    const fetchFn = global.fetch as ReturnType<typeof vi.fn>;
    const { useFeatureStore } = await import('./featureStore.js');

    // First call — loads flags
    await useFeatureStore.getState().fetchFlags();
    await waitFor(() => expect(useFeatureStore.getState().loaded).toBe(true));

    const callCount = fetchFn.mock.calls.length;

    // Second call — should return early because loaded = true
    await useFeatureStore.getState().fetchFlags();

    expect(fetchFn.mock.calls.length).toBe(callCount); // no extra fetch
  });
});
