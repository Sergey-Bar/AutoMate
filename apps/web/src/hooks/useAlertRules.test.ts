/// <reference types="vitest/globals" />
import { renderHook, waitFor, act } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { useAlertRules } from './useAlertRules.js';
import type { AlertRule } from './useAlertRules.js';

function makeRule(overrides: Partial<AlertRule> = {}): AlertRule {
  return {
    id: 'rule-1',
    name: 'Failure Alert',
    condition: 'on_failure',
    channel: 'slack',
    target: '#qa-alerts',
    enabled: true,
    ...overrides,
  };
}

function okJson(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function notOk(status = 500): Response {
  return new Response('Error', { status });
}

describe('useAlertRules', () => {
  describe('initial load', () => {
    it('starts with isLoading=true and empty rules', () => {
      const fetchFn = vi.fn(() => new Promise<Response>(() => {}));
      const { result } = renderHook(() => useAlertRules({ fetchFn }));
      expect(result.current.isLoading).toBe(true);
      expect(result.current.rules).toEqual([]);
      expect(result.current.error).toBeNull();
    });

    it('loads rules on success', async () => {
      const rules = [makeRule(), makeRule({ id: 'rule-2', name: 'Flaky Alert', condition: 'on_flaky' })];
      const fetchFn = vi.fn().mockResolvedValue(okJson(rules));
      const { result } = renderHook(() => useAlertRules({ fetchFn }));

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(result.current.rules).toEqual(rules);
      expect(result.current.error).toBeNull();
    });

    it('returns empty rules on 404 without setting an error', async () => {
      const fetchFn = vi.fn().mockResolvedValue(notOk(404));
      const { result } = renderHook(() => useAlertRules({ fetchFn }));

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      // 404 is treated as "not configured yet" — no error, just empty
      expect(result.current.rules).toEqual([]);
      expect(result.current.error).toBeNull();
    });

    it('sets error string on non-404 failure', async () => {
      const fetchFn = vi.fn().mockResolvedValue(notOk(503));
      const { result } = renderHook(() => useAlertRules({ fetchFn }));

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(result.current.error).toBe('Failed to load alert rules');
      expect(result.current.rules).toEqual([]);
    });

    it('sets error string on network rejection', async () => {
      const fetchFn = vi.fn().mockRejectedValue(new Error('DNS failure'));
      const { result } = renderHook(() => useAlertRules({ fetchFn }));

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(result.current.error).toBe('DNS failure');
    });

    it('does not update state after unmount', async () => {
      let resolve: (r: Response) => void = () => {};
      const fetchFn = vi.fn(() => new Promise<Response>((res) => { resolve = res; }));
      const { result, unmount } = renderHook(() => useAlertRules({ fetchFn }));

      unmount();
      resolve(okJson([makeRule()]));
      await Promise.resolve();

      expect(result.current.rules).toEqual([]);
    });

    it('uses globalThis.fetch as default when no fetchFn option provided', async () => {
      const rules = [makeRule()];
      const mockDefaultFetch = vi.fn().mockResolvedValue(okJson(rules));
      const original = globalThis.fetch;
      globalThis.fetch = mockDefaultFetch as typeof fetch;
      try {
        const { result } = renderHook(() => useAlertRules());
        await waitFor(() => expect(result.current.isLoading).toBe(false));
        expect(mockDefaultFetch).toHaveBeenCalledWith('/api/integrations/alert-rules');
        expect(result.current.rules).toEqual(rules);
      } finally {
        globalThis.fetch = original;
      }
    });
  });

  describe('createRule()', () => {
    beforeEach(() => {});

    it('posts new rule and appends it to rules list', async () => {
      const existing = makeRule();
      const created = makeRule({ id: 'rule-new', name: 'New Rule', condition: 'on_threshold' });
      const fetchFn = vi.fn()
        .mockResolvedValueOnce(okJson([existing]))
        .mockResolvedValueOnce(okJson(created));

      const { result } = renderHook(() => useAlertRules({ fetchFn }));
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      let returned: AlertRule | null = null;
      await act(async () => {
        returned = await result.current.createRule({
          name: 'New Rule',
          condition: 'on_threshold',
          channel: 'jira',
          target: 'PROJ',
          enabled: true,
        });
      });

      expect(returned).toEqual(created);
      expect(result.current.rules).toHaveLength(2);
      expect(result.current.rules[1]).toEqual(created);
      expect(fetchFn).toHaveBeenNthCalledWith(2, '/api/integrations/alert-rules', expect.objectContaining({ method: 'POST' }));
    });

    it('sets error and returns null on create failure', async () => {
      const fetchFn = vi.fn()
        .mockResolvedValueOnce(okJson([]))
        .mockResolvedValueOnce(notOk(422));

      const { result } = renderHook(() => useAlertRules({ fetchFn }));
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      let returned: AlertRule | null = undefined as unknown as AlertRule | null;
      await act(async () => {
        returned = await result.current.createRule({
          name: 'Bad', condition: 'on_failure', channel: 'slack', target: '#x', enabled: true,
        });
      });

      expect(returned).toBeNull();
      expect(result.current.error).toBe('Failed to create alert rule');
      expect(result.current.rules).toEqual([]);
    });
  });

  describe('updateRule()', () => {
    it('updates a rule in place and returns it', async () => {
      const original = makeRule();
      const updated = makeRule({ name: 'Updated Alert', enabled: false });
      const fetchFn = vi.fn()
        .mockResolvedValueOnce(okJson([original]))
        .mockResolvedValueOnce(okJson(updated));

      const { result } = renderHook(() => useAlertRules({ fetchFn }));
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      let returned: AlertRule | null = null;
      await act(async () => {
        returned = await result.current.updateRule('rule-1', { name: 'Updated Alert', enabled: false });
      });

      expect(returned).toEqual(updated);
      expect(result.current.rules[0]).toEqual(updated);
      expect(fetchFn).toHaveBeenNthCalledWith(2, '/api/integrations/alert-rules/rule-1', expect.objectContaining({ method: 'PUT' }));
    });

    it('sets error and returns null on update failure', async () => {
      const fetchFn = vi.fn()
        .mockResolvedValueOnce(okJson([makeRule()]))
        .mockResolvedValueOnce(notOk(404));

      const { result } = renderHook(() => useAlertRules({ fetchFn }));
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      let returned: AlertRule | null = undefined as unknown as AlertRule | null;
      await act(async () => {
        returned = await result.current.updateRule('rule-1', { enabled: false });
      });

      expect(returned).toBeNull();
      expect(result.current.error).toBe('Failed to update alert rule');
    });
  });

  describe('deleteRule()', () => {
    it('removes rule from list and returns true on success', async () => {
      const r1 = makeRule({ id: 'rule-1' });
      const r2 = makeRule({ id: 'rule-2' });
      const fetchFn = vi.fn()
        .mockResolvedValueOnce(okJson([r1, r2]))
        .mockResolvedValueOnce(new Response(null, { status: 204 }));

      const { result } = renderHook(() => useAlertRules({ fetchFn }));
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      let ok = false;
      await act(async () => {
        ok = await result.current.deleteRule('rule-1');
      });

      expect(ok).toBe(true);
      expect(result.current.rules).toHaveLength(1);
      expect(result.current.rules[0].id).toBe('rule-2');
    });

    it('sets error and returns false on delete failure', async () => {
      const fetchFn = vi.fn()
        .mockResolvedValueOnce(okJson([makeRule()]))
        .mockResolvedValueOnce(notOk(403));

      const { result } = renderHook(() => useAlertRules({ fetchFn }));
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      let ok = true;
      await act(async () => {
        ok = await result.current.deleteRule('rule-1');
      });

      expect(ok).toBe(false);
      expect(result.current.error).toBe('Failed to delete alert rule');
      expect(result.current.rules).toHaveLength(1); // unchanged
    });
  });

  describe('toggleRule()', () => {
    it('delegates to updateRule with the enabled flag', async () => {
      const original = makeRule({ enabled: true });
      const toggled = makeRule({ enabled: false });
      const fetchFn = vi.fn()
        .mockResolvedValueOnce(okJson([original]))
        .mockResolvedValueOnce(okJson(toggled));

      const { result } = renderHook(() => useAlertRules({ fetchFn }));
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      await act(async () => {
        await result.current.toggleRule('rule-1', false);
      });

      expect(result.current.rules[0].enabled).toBe(false);
    });
  });
});
