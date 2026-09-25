import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

// Mock DNS-based SSRF validation — in tests we don't want real DNS lookups
vi.mock('../../../utils/url-validation.js', () => ({
  assertExternalUrlWithDNS: vi.fn().mockResolvedValue(undefined),
}));

import * as fs from 'fs';
import { dispatchAllWebhooks, dispatchWebhook } from '../webhooks.js';

const mockFetch = vi.fn();

function mockResponse(init: { ok: boolean; status: number }): Response {
  return {
    ok: init.ok,
    status: init.status,
  } as unknown as Response;
}

describe('webhooks integration', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockReset();
    vi.mocked(fs.existsSync).mockReset();
    vi.mocked(fs.readFileSync).mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('dispatchWebhook', () => {
    it('posts event, payload and timestamp and succeeds on first try', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ ok: true, status: 200 }));

      await dispatchWebhook('https://hooks.example.com/a', 'run.completed', { runId: 'r1' });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, req] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://hooks.example.com/a');
      expect(req.method).toBe('POST');
      expect(req.headers).toEqual({ 'Content-Type': 'application/json' });

      const body = JSON.parse(String(req.body)) as {
        event: string;
        payload: { runId: string };
        timestamp: string;
      };
      expect(body.event).toBe('run.completed');
      expect(body.payload).toEqual({ runId: 'r1' });
      expect(typeof body.timestamp).toBe('string');
      expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false);
    });

    it('retries on server errors with delays 1s then 2s and succeeds later', async () => {
      vi.useFakeTimers();
      mockFetch
        .mockResolvedValueOnce(mockResponse({ ok: false, status: 500 }))
        .mockResolvedValueOnce(mockResponse({ ok: false, status: 503 }))
        .mockResolvedValueOnce(mockResponse({ ok: true, status: 200 }));

      const promise = dispatchWebhook('https://hooks.example.com/retry', 'run.failed', { id: 1 });

      // Flush the SSRF validation microtask so the first fetch fires
      await vi.advanceTimersByTimeAsync(0);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1000);
      expect(mockFetch).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(2000);
      expect(mockFetch).toHaveBeenCalledTimes(3);

      await expect(promise).resolves.toBeUndefined();
    });

    it('throws on client error response', async () => {
      vi.useFakeTimers();
      mockFetch
        .mockResolvedValueOnce(mockResponse({ ok: false, status: 400 }))
        .mockResolvedValueOnce(mockResponse({ ok: false, status: 400 }))
        .mockResolvedValueOnce(mockResponse({ ok: false, status: 400 }));

      const promise = dispatchWebhook('https://hooks.example.com/client-error', 'run.failed', { id: 2 });
      const assertion = expect(promise).rejects.toThrow('Webhook failed with status 400');

      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(2000);
      await assertion;

      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('throws after all retries fail for network errors', async () => {
      vi.useFakeTimers();
      mockFetch
        .mockRejectedValueOnce(new Error('net-1'))
        .mockRejectedValueOnce(new Error('net-2'))
        .mockRejectedValueOnce(new Error('net-3'));

      const promise = dispatchWebhook('https://hooks.example.com/down', 'run.failed', { id: 3 });
      const assertion = expect(promise).rejects.toThrow('net-3');

      // Flush the SSRF validation microtask so the first fetch fires
      await vi.advanceTimersByTimeAsync(0);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1000);
      expect(mockFetch).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(2000);
      expect(mockFetch).toHaveBeenCalledTimes(3);

      await assertion;
    });

    it('silently resolves after three consecutive 5xx server errors (no retry delay on last attempt)', async () => {
      vi.useFakeTimers();
      mockFetch
        .mockResolvedValueOnce(mockResponse({ ok: false, status: 500 }))
        .mockResolvedValueOnce(mockResponse({ ok: false, status: 503 }))
        .mockResolvedValueOnce(mockResponse({ ok: false, status: 500 }));

      const promise = dispatchWebhook('https://hooks.example.com/5xx-only', 'run.failed', { id: 99 });

      await vi.advanceTimersByTimeAsync(0);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1000);
      expect(mockFetch).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(2000);
      expect(mockFetch).toHaveBeenCalledTimes(3);

      // All 3 attempts fail with 5xx (not 4xx), so no exception is thrown
      await expect(promise).resolves.toBeUndefined();
    });
  });

  describe('dispatchAllWebhooks', () => {
    it('returns silently when config file does not exist', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      await expect(dispatchAllWebhooks('run.completed', { id: 'x' })).resolves.toBeUndefined();
      expect(fs.readFileSync).not.toHaveBeenCalled();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('returns silently when config JSON parsing fails', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('{broken-json' as unknown as string);

      await expect(dispatchAllWebhooks('run.completed', { id: 'x' })).resolves.toBeUndefined();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('returns silently when config JSON fails schema validation', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      // Valid JSON but `webhooks` must be an array — passing a string fails the Zod schema
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ webhooks: 'invalid' }) as unknown as string);

      await expect(dispatchAllWebhooks('run.completed', { id: 'x' })).resolves.toBeUndefined();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('dispatches only matching webhooks and settles all in parallel', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({
          webhooks: [
            { url: 'https://hooks.example.com/a', events: ['run.completed'] },
            { url: 'https://hooks.example.com/b', events: ['run.completed', 'run.failed'] },
            { url: 'https://hooks.example.com/c', events: ['run.started'] },
          ],
        }) as unknown as string,
      );

      mockFetch
        .mockResolvedValueOnce(mockResponse({ ok: true, status: 200 }))
        .mockResolvedValueOnce(mockResponse({ ok: false, status: 400 }));

      await expect(dispatchAllWebhooks('run.completed', { runId: 'run-1' })).resolves.toBeUndefined();

      const calledUrls = mockFetch.mock.calls.map((c) => c[0]);
      expect(calledUrls).toContain('https://hooks.example.com/a');
      expect(calledUrls).toContain('https://hooks.example.com/b');
      expect(calledUrls).not.toContain('https://hooks.example.com/c');
    });
  });
});
