import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { useA11yAudit } from './useA11yAudit.js';
import type { A11yAuditResult } from './useA11yAudit.js';

const reactMocks = vi.hoisted(() => ({
  useState: vi.fn(),
  useEffect: vi.fn(),
}));

const hookMocks = vi.hoisted(() => ({
  setData: vi.fn(),
  setLoading: vi.fn(),
  setError: vi.fn(),
  setTick: vi.fn(),
  effectCallback: null as null | (() => void),
}));

vi.mock('react', () => ({
  useState: reactMocks.useState,
  useEffect: reactMocks.useEffect,
}));

const originalFetch = globalThis.fetch;
const mockFetch = vi.fn();

const flushPromises = async () => {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
};

describe('useA11yAudit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    hookMocks.effectCallback = null;

    (globalThis as { fetch: typeof fetch }).fetch = mockFetch as unknown as typeof fetch;

    let stateCallIndex = 0;
    reactMocks.useState.mockImplementation((initialValue: unknown) => {
      stateCallIndex += 1;
      if (stateCallIndex === 1) return [initialValue, hookMocks.setData] as const;
      if (stateCallIndex === 2) return [initialValue, hookMocks.setLoading] as const;
      if (stateCallIndex === 3) return [initialValue, hookMocks.setError] as const;
      if (stateCallIndex === 4) return [initialValue, hookMocks.setTick] as const;
      throw new Error(`Unexpected useState call #${stateCallIndex}`);
    });

    reactMocks.useEffect.mockImplementation((callback: () => void) => {
      hookMocks.effectCallback = callback;
    });
  });

  afterAll(() => {
    (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
  });

  it('returns initial state with loading=true and data=null', () => {
    const result = useA11yAudit();
    expect(result.data).toBeNull();
    expect(result.loading).toBe(true);
    expect(result.error).toBeNull();
    expect(result.refetch).toBeTypeOf('function');
    expect(reactMocks.useEffect).toHaveBeenCalledWith(expect.any(Function), [0]);
  });

  it('fetches /api/a11y/audit and sets data on success', async () => {
    const auditResult: A11yAuditResult = {
      violations: [
        {
          id: 'v1',
          ruleId: 'color-contrast',
          description: 'Insufficient color contrast',
          severity: 'serious',
          element: 'button.submit',
          fix: 'Increase contrast ratio to at least 4.5:1',
          page: '/home',
        },
      ],
      pagesScanned: 3,
      scannedAt: '2026-05-26T00:00:00.000Z',
    };

    mockFetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(auditResult),
    });

    useA11yAudit();

    expect(hookMocks.effectCallback).not.toBeNull();
    hookMocks.effectCallback!();
    await flushPromises();

    expect(mockFetch).toHaveBeenCalledWith('/api/a11y/audit', expect.objectContaining({ signal: expect.anything() }));
    expect(hookMocks.setData).toHaveBeenCalledWith(auditResult);
    expect(hookMocks.setError).toHaveBeenCalledWith(null);
    expect(hookMocks.setLoading).toHaveBeenCalledWith(false);
  });

  it('sets error when fetch fails', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500 });

    useA11yAudit();
    hookMocks.effectCallback!();
    await flushPromises();

    expect(hookMocks.setError).toHaveBeenCalledWith(expect.stringContaining('500'));
    expect(hookMocks.setLoading).toHaveBeenCalledWith(false);
  });

  it('sets error when network throws', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'));

    useA11yAudit();
    hookMocks.effectCallback!();
    await flushPromises();

    expect(hookMocks.setError).toHaveBeenCalledWith('Network error');
  });

  it('does not set error on AbortError', async () => {
    const abortError = new Error('Aborted');
    abortError.name = 'AbortError';
    mockFetch.mockRejectedValue(abortError);

    useA11yAudit();
    hookMocks.effectCallback!();
    await flushPromises();

    expect(hookMocks.setError).not.toHaveBeenCalled();
  });

  it('returns cleanup function that aborts fetch', () => {
    mockFetch.mockResolvedValue({ ok: true, json: vi.fn().mockResolvedValue({}) });

    useA11yAudit();
    const cleanup = hookMocks.effectCallback!() as unknown as (() => void) | undefined;
    expect(cleanup).toBeTypeOf('function');
  });
});
