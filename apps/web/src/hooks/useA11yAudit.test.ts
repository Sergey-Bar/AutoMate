import { renderHook, waitFor, act } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useA11yAudit } from './useA11yAudit.js';
import type { ApiClient, A11yAuditResult } from '../lib/api.js';

function createApi(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    getRuns: vi.fn().mockResolvedValue([]),
    getRun: vi.fn(),
    getSuites: vi.fn(),
    getTests: vi.fn(),
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
    getConnectors: vi.fn(),
    getVaultSecrets: vi.fn(),
    deleteVaultSecret: vi.fn(),
    getA11yAudit: vi.fn().mockResolvedValue({
      violations: [],
      pagesScanned: 0,
      scannedAt: '2026-05-26T00:00:00.000Z',
    }),
    ...overrides,
  } as unknown as ApiClient;
}

const sampleAudit: A11yAuditResult = {
  violations: [
    {
      id: 'v1',
      ruleId: 'color-contrast',
      description: 'Insufficient color contrast',
      severity: 'serious',
      element: 'button.submit',
      fix: 'Increase contrast ratio',
      page: '/home',
    },
  ],
  pagesScanned: 3,
  scannedAt: '2026-05-26T00:00:00.000Z',
};

describe('useA11yAudit', () => {
  it('returns loading state initially', () => {
    const api = createApi({ getA11yAudit: vi.fn(() => new Promise<A11yAuditResult>(() => {})) });
    const { result } = renderHook(() => useA11yAudit(api));
    expect(result.current.isLoading).toBe(true);
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('fetches audit data and sets data on success', async () => {
    const api = createApi({ getA11yAudit: vi.fn().mockResolvedValue(sampleAudit) });
    const { result } = renderHook(() => useA11yAudit(api));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.data).toEqual(sampleAudit);
    expect(result.current.error).toBeNull();
  });

  it('sets error when API fails', async () => {
    const api = createApi({
      getA11yAudit: vi.fn().mockRejectedValue(new Error('Network error')),
    });
    const { result } = renderHook(() => useA11yAudit(api));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toBe('Network error');
    expect(result.current.data).toBeNull();
  });

  it('exposes a refetch function', () => {
    const api = createApi();
    const { result } = renderHook(() => useA11yAudit(api));
    expect(result.current.refetch).toBeTypeOf('function');
  });

  it('calls getA11yAudit on mount', async () => {
    const getA11yAudit = vi.fn().mockResolvedValue(sampleAudit);
    const api = createApi({ getA11yAudit });
    renderHook(() => useA11yAudit(api));

    await waitFor(() => {
      expect(getA11yAudit).toHaveBeenCalledTimes(1);
    });
  });

  it('refetch() triggers a second getA11yAudit call and updates data', async () => {
    const freshAudit: A11yAuditResult = { violations: [], pagesScanned: 5, scannedAt: '2026-06-01T00:00:00.000Z' };
    const getA11yAudit = vi.fn()
      .mockResolvedValueOnce(sampleAudit)
      .mockResolvedValueOnce(freshAudit);
    const api = createApi({ getA11yAudit });

    const { result } = renderHook(() => useA11yAudit(api));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toEqual(sampleAudit);

    act(() => {
      result.current.refetch();
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(getA11yAudit).toHaveBeenCalledTimes(2);
    expect(result.current.data).toEqual(freshAudit);
  });

  it('refetch() propagates error from the second fetch', async () => {
    const getA11yAudit = vi.fn()
      .mockResolvedValueOnce(sampleAudit)
      .mockRejectedValueOnce(new Error('audit service down'));
    const api = createApi({ getA11yAudit });

    const { result } = renderHook(() => useA11yAudit(api));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      result.current.refetch();
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error?.message).toBe('audit service down');
  });

  it('does not update state after unmount (mounted guard)', async () => {
    let resolve: (v: A11yAuditResult) => void = () => {};
    const api = createApi({
      getA11yAudit: vi.fn(() => new Promise<A11yAuditResult>((res) => { resolve = res; })),
    });

    const { result, unmount } = renderHook(() => useA11yAudit(api));
    expect(result.current.isLoading).toBe(true);

    unmount();
    resolve(sampleAudit);
    await Promise.resolve();

    // Data and loading state must not have changed after unmount
    expect(result.current.data).toBeNull();
    expect(result.current.isLoading).toBe(true);
  });
});
