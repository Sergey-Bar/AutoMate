import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { run } from './mcp.js';

describe('mcp command', () => {
  const mockFetch = vi.fn();
  const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.fetch = mockFetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function mockJsonResponse(data: unknown, status = 200): void {
    mockFetch.mockResolvedValueOnce({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(data),
      text: () => Promise.resolve(JSON.stringify(data)),
    });
  }

  describe('list subcommand', () => {
    it('calls GET /api/mcp/servers and prints table when servers exist', async () => {
      mockJsonResponse({
        servers: [
          {
            id: 'github-mcp',
            name: 'GitHub MCP',
            transport: 'stdio',
            enabled: true,
            toolPrefix: 'gh',
            running: true,
          },
          {
            id: 'jira-mcp',
            name: 'Jira MCP',
            transport: 'http',
            enabled: false,
            toolPrefix: 'jira',
            running: false,
          },
        ],
      });

      await run(['list']);

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url] = mockFetch.mock.calls[0] as [string, ...unknown[]];
      expect(url).toContain('/api/mcp/servers');
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('MCP Servers'));
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('github-mcp'));
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('jira-mcp'));
    });

    it('prints "No MCP servers registered" when server list is empty', async () => {
      mockJsonResponse({ servers: [] });

      await run(['list']);

      expect(logSpy).toHaveBeenCalledWith('No MCP servers registered.');
    });
  });

  describe('status subcommand', () => {
    it('calls GET /api/mcp/servers/:id/status and prints details', async () => {
      mockJsonResponse({
        id: 'github-mcp',
        name: 'GitHub MCP',
        transport: 'stdio',
        enabled: true,
        toolPrefix: 'gh',
        running: true,
        pid: 12345,
      });

      await run(['status', 'github-mcp']);

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url] = mockFetch.mock.calls[0] as [string, ...unknown[]];
      expect(url).toContain('/api/mcp/servers/github-mcp/status');
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('GitHub MCP'));
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('stdio'));
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('12345'));
    });

    it('prints error and exits when no server ID is provided', async () => {
      await run(['status']);

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('server ID is required')
      );
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('start subcommand', () => {
    it('calls POST /api/mcp/servers/:id/start and prints success message', async () => {
      mockJsonResponse({ message: 'Server github-mcp started' }, 202);

      await run(['start', 'github-mcp']);

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('/api/mcp/servers/github-mcp/start');
      expect(options.method).toBe('POST');
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Server github-mcp started'));
    });

    it('prints error and exits when no server ID is provided', async () => {
      await run(['start']);

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('server ID is required')
      );
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('stop subcommand', () => {
    it('calls POST /api/mcp/servers/:id/stop and prints success message', async () => {
      mockJsonResponse({ message: 'Server github-mcp stopped' }, 200);

      await run(['stop', 'github-mcp']);

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('/api/mcp/servers/github-mcp/stop');
      expect(options.method).toBe('POST');
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Server github-mcp stopped'));
    });

    it('prints error and exits when no server ID is provided', async () => {
      await run(['stop']);

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('server ID is required')
      );
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('default / no subcommand', () => {
    it('prints usage when no subcommand is given', async () => {
      await run([]);

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('Usage: Automate mcp')
      );
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('prints error message and exits with 1 on API failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Internal Server Error'),
      });

      await run(['list']);

      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Dashboard API error'));
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });
});
