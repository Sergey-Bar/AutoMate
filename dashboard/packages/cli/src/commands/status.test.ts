import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { run } from './status.js';

describe('status command', () => {
  const mockFetch = vi.fn();
  const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  const originalFetch = globalThis.fetch;
  const originalEnv = process.env.AUTOMATE_DASHBOARD_URL;

  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.fetch = mockFetch;
    delete process.env.AUTOMATE_DASHBOARD_URL;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalEnv !== undefined) {
      process.env.AUTOMATE_DASHBOARD_URL = originalEnv;
    } else {
      delete process.env.AUTOMATE_DASHBOARD_URL;
    }
  });

  function mockJsonResponse(data: unknown, status = 200): void {
    mockFetch.mockResolvedValueOnce({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(data),
      text: () => Promise.resolve(JSON.stringify(data)),
    });
  }

  function mockFailure(): void {
    mockFetch.mockRejectedValueOnce(new Error('Connection refused'));
  }

  describe('online scenario', () => {
    it('shows Online health and MCP server summary when dashboard is up', async () => {
      // First call: health check
      mockJsonResponse({});
      // Second call: mcp servers
      mockJsonResponse({
        servers: [
          { id: 'github-mcp', name: 'GitHub MCP', running: true },
          { id: 'jira-mcp', name: 'Jira MCP', running: false },
        ],
      });

      await run();

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('● Online'));
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('2 registered, 1 running'));
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('GitHub MCP'));
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Jira MCP'));
    });

    it('shows dashboard base URL in output', async () => {
      process.env.AUTOMATE_DASHBOARD_URL = 'http://my-server:4000';
      mockJsonResponse({});
      mockJsonResponse({ servers: [] });

      await run();

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('http://my-server:4000'));
    });

    it('shows MCP gateway not available when MCP endpoint fails', async () => {
      // Health succeeds
      mockJsonResponse({});
      // MCP servers fails
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
        text: () => Promise.resolve('Service Unavailable'),
        json: () => Promise.resolve({}),
      });

      await run();

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('● Online'));
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Gateway not available'));
    });

    it('shows "0 running" when no servers are running', async () => {
      mockJsonResponse({});
      mockJsonResponse({
        servers: [
          { id: 'svc-1', name: 'Service 1', running: false },
          { id: 'svc-2', name: 'Service 2', running: false },
        ],
      });

      await run();

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('2 registered, 0 running'));
    });
  });

  describe('offline scenario', () => {
    it('shows Offline when health check fails with network error', async () => {
      mockFailure();

      await run();

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('○ Offline or unreachable'));
    });

    it('stops early and does not check MCP when dashboard is offline', async () => {
      mockFailure();

      await run();

      // Only one fetch call (the health check), not two
      expect(mockFetch).toHaveBeenCalledOnce();
    });

    it('shows Offline when health endpoint returns non-ok status', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
        text: () => Promise.resolve('Service Unavailable'),
        json: () => Promise.resolve({}),
      });

      await run();

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('○ Offline or unreachable'));
    });
  });
});
