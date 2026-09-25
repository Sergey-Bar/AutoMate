/// <reference types="vitest/globals" />
import { renderHook, waitFor, act } from '@testing-library/react';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { useGitHubIntegration } from './useGitHubIntegration.js';
import type { GitHubConfig, GitHubConnectionStatus } from './useGitHubIntegration.js';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function okJson(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function notOk(status = 500): Response {
  return new Response('Error', { status });
}

const fullConfig: GitHubConfig = {
  repoUrl: 'https://github.com/org/repo',
  token: 'ghp_secret',
  events: { push: true, pull_request: true, schedule: false },
};

describe('useGitHubIntegration', () => {
  describe('initial load', () => {
    it('starts with default config and isLoading=true', () => {
      const fetchFn = vi.fn(() => new Promise<Response>(() => {}));
      const { result } = renderHook(() => useGitHubIntegration({ fetchFn }));
      expect(result.current.isLoading).toBe(true);
      expect(result.current.config.repoUrl).toBe('');
      expect(result.current.config.token).toBe('');
      expect(result.current.error).toBeNull();
    });

    it('loads config and clears loading on success', async () => {
      const fetchFn = vi.fn().mockResolvedValue(okJson(fullConfig));
      const { result } = renderHook(() => useGitHubIntegration({ fetchFn }));

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(result.current.config).toEqual(fullConfig);
      expect(result.current.error).toBeNull();
    });

    it('updates status when API response includes status field', async () => {
      const status: GitHubConnectionStatus = { connected: true, checkedAt: '2026-06-01T00:00:00.000Z' };
      const fetchFn = vi.fn().mockResolvedValue(okJson({ ...fullConfig, status }));
      const { result } = renderHook(() => useGitHubIntegration({ fetchFn }));

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(result.current.status.connected).toBe(true);
      expect(result.current.status.checkedAt).toBe('2026-06-01T00:00:00.000Z');
    });

    it('does not change status when API response has no status field', async () => {
      const fetchFn = vi.fn().mockResolvedValue(okJson(fullConfig));
      const { result } = renderHook(() => useGitHubIntegration({ fetchFn }));

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      // Default status — connected=false, checkedAt=null
      expect(result.current.status.connected).toBe(false);
      expect(result.current.status.checkedAt).toBeNull();
    });

    it('fills missing config fields with defaults via nullish coalescing', async () => {
      // API response with no repoUrl, no token, no events
      const fetchFn = vi.fn().mockResolvedValue(okJson({}));
      const { result } = renderHook(() => useGitHubIntegration({ fetchFn }));

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(result.current.config.repoUrl).toBe('');
      expect(result.current.config.token).toBe('');
      expect(result.current.config.events.push).toBe(false);
      expect(result.current.config.events.pull_request).toBe(true); // default true
      expect(result.current.config.events.schedule).toBe(false);
    });

    it('stops loading on 404 without setting error (not-configured-yet case)', async () => {
      const fetchFn = vi.fn().mockResolvedValue(notOk(404));
      const { result } = renderHook(() => useGitHubIntegration({ fetchFn }));

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(result.current.error).toBeNull();
      expect(result.current.config.repoUrl).toBe(''); // unchanged default
    });

    it('sets error string on other non-ok responses', async () => {
      const fetchFn = vi.fn().mockResolvedValue(notOk(503));
      const { result } = renderHook(() => useGitHubIntegration({ fetchFn }));

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(result.current.error).toBe('Failed to load GitHub integration config');
    });

    it('sets error on network rejection', async () => {
      const fetchFn = vi.fn().mockRejectedValue(new Error('network error'));
      const { result } = renderHook(() => useGitHubIntegration({ fetchFn }));

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(result.current.error).toBe('network error');
    });
  });

  describe('saveConfig()', () => {
    it('saves config and sets saveSuccess=true then resets after 3s', async () => {
      const fetchFn = vi.fn()
        .mockResolvedValueOnce(okJson(fullConfig)) // initial load
        .mockResolvedValueOnce(okJson(fullConfig)); // save

      const { result } = renderHook(() => useGitHubIntegration({ fetchFn }));
      // Use real timers for waitFor polling, switch fake only after load completes
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      vi.useFakeTimers();
      try {
        await act(async () => {
          await result.current.saveConfig(fullConfig);
        });

        expect(result.current.saveSuccess).toBe(true);
        expect(result.current.isSaving).toBe(false);
        expect(result.current.config).toEqual(fullConfig);

        // After 3 seconds the flag auto-resets
        act(() => { vi.advanceTimersByTime(3000); });
        expect(result.current.saveSuccess).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });

    it('sets error and clears isSaving on save failure', async () => {
      const fetchFn = vi.fn()
        .mockResolvedValueOnce(okJson(fullConfig))
        .mockResolvedValueOnce(notOk(422));

      const { result } = renderHook(() => useGitHubIntegration({ fetchFn }));
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      await act(async () => {
        await result.current.saveConfig(fullConfig);
      });

      expect(result.current.error).toBe('Failed to save GitHub integration config');
      expect(result.current.isSaving).toBe(false);
      expect(result.current.saveSuccess).toBe(false);
    });

    it('resets isSaving to false after save completes successfully', async () => {
      const fetchFn = vi.fn()
        .mockResolvedValueOnce(okJson(fullConfig))
        .mockResolvedValueOnce(okJson(fullConfig));

      const { result } = renderHook(() => useGitHubIntegration({ fetchFn }));
      await waitFor(() => expect(result.current.isLoading).toBe(false));
      expect(result.current.isSaving).toBe(false);

      await act(async () => {
        await result.current.saveConfig(fullConfig);
      });

      expect(result.current.isSaving).toBe(false);
    });
  });

  describe('testConnection()', () => {
    it('updates status with connected=true on successful test', async () => {
      const fetchFn = vi.fn()
        .mockResolvedValueOnce(okJson(fullConfig))
        .mockResolvedValueOnce(okJson({ connected: true }));

      const { result } = renderHook(() => useGitHubIntegration({ fetchFn }));
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      await act(async () => {
        await result.current.testConnection(fullConfig);
      });

      expect(result.current.status.connected).toBe(true);
      expect(result.current.status.checkedAt).not.toBeNull();
      expect(result.current.isTesting).toBe(false);
    });

    it('updates status with connected=false on failed test response', async () => {
      const fetchFn = vi.fn()
        .mockResolvedValueOnce(okJson(fullConfig))
        .mockResolvedValueOnce(okJson({ connected: false }));

      const { result } = renderHook(() => useGitHubIntegration({ fetchFn }));
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      await act(async () => {
        await result.current.testConnection(fullConfig);
      });

      expect(result.current.status.connected).toBe(false);
    });

    it('sets error and connected=false on non-ok test response', async () => {
      const fetchFn = vi.fn()
        .mockResolvedValueOnce(okJson(fullConfig))
        .mockResolvedValueOnce(notOk(502));

      const { result } = renderHook(() => useGitHubIntegration({ fetchFn }));
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      await act(async () => {
        await result.current.testConnection(fullConfig);
      });

      expect(result.current.error).toBe('Connection test failed');
      expect(result.current.status.connected).toBe(false);
      expect(result.current.status.checkedAt).not.toBeNull();
      expect(result.current.isTesting).toBe(false);
    });

    it('sets error and connected=false on network rejection', async () => {
      const fetchFn = vi.fn()
        .mockResolvedValueOnce(okJson(fullConfig))
        .mockRejectedValueOnce(new Error('timeout'));

      const { result } = renderHook(() => useGitHubIntegration({ fetchFn }));
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      await act(async () => {
        await result.current.testConnection(fullConfig);
      });

      expect(result.current.error).toBe('timeout');
      expect(result.current.status.connected).toBe(false);
    });

    it('posts to /api/integrations/github/test with repoUrl and token', async () => {
      const fetchFn = vi.fn()
        .mockResolvedValueOnce(okJson(fullConfig))
        .mockResolvedValueOnce(okJson({ connected: true }));

      const { result } = renderHook(() => useGitHubIntegration({ fetchFn }));
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      await act(async () => {
        await result.current.testConnection(fullConfig);
      });

      expect(fetchFn).toHaveBeenNthCalledWith(2, '/api/integrations/github/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoUrl: fullConfig.repoUrl, token: fullConfig.token }),
      });
    });
  });

  describe('setConfig()', () => {
    it('exposes a setConfig setter for local state updates', async () => {
      const fetchFn = vi.fn().mockResolvedValue(okJson(fullConfig));
      const { result } = renderHook(() => useGitHubIntegration({ fetchFn }));
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      act(() => {
        result.current.setConfig({ ...fullConfig, repoUrl: 'https://github.com/other/repo' });
      });

      expect(result.current.config.repoUrl).toBe('https://github.com/other/repo');
    });
  });

  it('uses globalThis.fetch as default when no fetchFn option provided', async () => {
    const mockDefaultFetch = vi.fn().mockResolvedValue(okJson(fullConfig));
    const original = globalThis.fetch;
    globalThis.fetch = mockDefaultFetch as typeof fetch;
    try {
      const { result } = renderHook(() => useGitHubIntegration());
      await waitFor(() => expect(result.current.isLoading).toBe(false));
      expect(mockDefaultFetch).toHaveBeenCalledWith('/api/integrations/github');
      expect(result.current.config.repoUrl).toBe(fullConfig.repoUrl);
    } finally {
      globalThis.fetch = original;
    }
  });
});
