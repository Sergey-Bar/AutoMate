import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getConfig, fetchApi } from './api-client.js';

describe('api-client', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.AUTOMATE_DASHBOARD_URL;
    delete process.env.AUTOMATE_DASHBOARD_API_KEY;
  });

  afterEach(() => {
    // Restore env
    if (originalEnv.AUTOMATE_DASHBOARD_URL !== undefined) {
      process.env.AUTOMATE_DASHBOARD_URL = originalEnv.AUTOMATE_DASHBOARD_URL;
    } else {
      delete process.env.AUTOMATE_DASHBOARD_URL;
    }
    if (originalEnv.AUTOMATE_DASHBOARD_API_KEY !== undefined) {
      process.env.AUTOMATE_DASHBOARD_API_KEY = originalEnv.AUTOMATE_DASHBOARD_API_KEY;
    } else {
      delete process.env.AUTOMATE_DASHBOARD_API_KEY;
    }
  });

  describe('getConfig', () => {
    it('returns default baseUrl when env var not set', () => {
      const config = getConfig();
      expect(config.baseUrl).toBe('http://localhost:4000');
    });

    it('returns custom baseUrl from env var', () => {
      process.env.AUTOMATE_DASHBOARD_URL = 'http://my-server:9000';
      const config = getConfig();
      expect(config.baseUrl).toBe('http://my-server:9000');
    });

    it('returns undefined apiKey when env var not set', () => {
      const config = getConfig();
      expect(config.apiKey).toBeUndefined();
    });

    it('returns apiKey from env var', () => {
      process.env.AUTOMATE_DASHBOARD_API_KEY = 'my-secret-key';
      const config = getConfig();
      expect(config.apiKey).toBe('my-secret-key');
    });
  });

  describe('fetchApi', () => {
    const mockFetch = vi.fn();
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
      globalThis.fetch = mockFetch;
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it('calls fetch with correct URL and content-type header', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ result: 'ok' }),
      });

      await fetchApi('/api/test');

      const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('http://localhost:4000/api/test');
      expect((options.headers as Record<string, string>)['content-type']).toBe('application/json');
    });

    it('includes authorization header when apiKey is set', async () => {
      process.env.AUTOMATE_DASHBOARD_API_KEY = 'test-api-key';
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ result: 'ok' }),
      });

      await fetchApi('/api/test');

      const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect((options.headers as Record<string, string>)['authorization']).toBe('Bearer test-api-key');
    });

    it('does not include authorization header when apiKey is not set', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ result: 'ok' }),
      });

      await fetchApi('/api/test');

      const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect((options.headers as Record<string, string>)['authorization']).toBeUndefined();
    });

    it('throws on non-ok response with status and body', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: () => Promise.resolve('Not Found'),
        json: () => Promise.resolve({}),
      });

      await expect(fetchApi('/api/missing')).rejects.toThrow('Dashboard API error (404): Not Found');
    });

    it('merges caller-provided headers with defaults', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({}),
      });

      await fetchApi('/api/test', {
        headers: { 'x-custom': 'value' },
      });

      const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect((options.headers as Record<string, string>)['x-custom']).toBe('value');
      expect((options.headers as Record<string, string>)['content-type']).toBe('application/json');
    });

    it('passes method option through to fetch', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ message: 'done' }),
      });

      await fetchApi('/api/action', { method: 'POST' });

      const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(options.method).toBe('POST');
    });
  });
});
