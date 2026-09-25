import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDashboardMcpClient } from './mcp-client.js';

type JsonRpcRequest = { jsonrpc: '2.0'; id?: number | string; method: string; params?: Record<string, unknown> };

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('DashboardMcpClient', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
    delete process.env.DASHBOARD_SERVICE_ACCOUNT_KEY;
    delete process.env.DASHBOARD_MCP_API_KEY;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete process.env.DASHBOARD_SERVICE_ACCOUNT_KEY;
    delete process.env.DASHBOARD_MCP_API_KEY;
  });

  it('connects over streamable HTTP, discovers tools, and calls tool with bearer auth', async () => {
    const fetchMock = vi.fn(async (_input: URL | RequestInfo, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as JsonRpcRequest;
      const headers = new Headers(init?.headers);

      expect(headers.get('authorization')).toBe('Bearer dashboard-key');

      if (body.method === 'initialize') {
        return jsonResponse({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            protocolVersion: String(body.params?.protocolVersion ?? '2025-06-18'),
            capabilities: { tools: {} },
            serverInfo: { name: 'dashboard-mcp', version: '1.0.0' },
          },
        });
      }

      if (body.method === 'tools/list') {
        return jsonResponse({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            tools: [{
              name: 'runs.list_recent',
              description: 'List recent runs',
              inputSchema: { type: 'object' },
            }],
          },
        });
      }

      if (body.method === 'tools/call') {
        return jsonResponse({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            content: [{ type: 'text', text: 'dashboard-result' }],
          },
        });
      }

      return jsonResponse({ jsonrpc: '2.0', id: body.id, result: {} });
    });

    globalThis.fetch = fetchMock as typeof fetch;

    const client = createDashboardMcpClient({
      url: 'http://dashboard.test/mcp',
      apiKey: 'dashboard-key',
      connectTimeoutMs: 2000,
      toolTimeoutMs: 2000,
    });

    await client.connect();
    const tools = await client.listTools();
    const result = await client.callTool('runs.list_recent', { workspaceId: 'ws-1' });

    expect(tools.map((tool) => tool.name)).toEqual(['runs.list_recent']);
    expect(result).toEqual({
      content: [{ type: 'text', text: 'dashboard-result' }],
      isError: false,
    });

    await client.disconnect();
  });

  it('returns actionable error when mcp endpoint is unavailable', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('connect ECONNREFUSED 127.0.0.1:3001');
    }) as typeof fetch;

    const client = createDashboardMcpClient({
      url: 'http://dashboard.test/mcp',
      apiKey: 'dashboard-key',
      connectTimeoutMs: 300,
      toolTimeoutMs: 300,
    });

    await expect(client.listTools()).rejects.toThrow('Dashboard MCP');
    await expect(client.listTools()).rejects.toThrow('unavailable');
  });

  it('uses DASHBOARD_SERVICE_ACCOUNT_KEY env var as higher-priority fallback over DASHBOARD_MCP_API_KEY', async () => {
    process.env.DASHBOARD_SERVICE_ACCOUNT_KEY = 'service-account-key';
    process.env.DASHBOARD_MCP_API_KEY = 'regular-api-key';

    const fetchMock = vi.fn(async (_input: URL | RequestInfo, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as JsonRpcRequest;
      const headers = new Headers(init?.headers);

      // Service account key must take priority
      expect(headers.get('authorization')).toBe('Bearer service-account-key');

      if (body.method === 'initialize') {
        return jsonResponse({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            protocolVersion: String(body.params?.protocolVersion ?? '2025-06-18'),
            capabilities: { tools: {} },
            serverInfo: { name: 'dashboard-mcp', version: '1.0.0' },
          },
        });
      }

      return jsonResponse({ jsonrpc: '2.0', id: body.id, result: {} });
    });

    globalThis.fetch = fetchMock as typeof fetch;

    const client = createDashboardMcpClient({ url: 'http://dashboard.test/mcp', connectTimeoutMs: 2000, toolTimeoutMs: 2000 });
    await client.connect();
    await client.disconnect();
  });

  it('falls back to DASHBOARD_MCP_API_KEY when DASHBOARD_SERVICE_ACCOUNT_KEY is not set', async () => {
    process.env.DASHBOARD_MCP_API_KEY = 'fallback-api-key';

    const fetchMock = vi.fn(async (_input: URL | RequestInfo, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as JsonRpcRequest;
      const headers = new Headers(init?.headers);

      expect(headers.get('authorization')).toBe('Bearer fallback-api-key');

      if (body.method === 'initialize') {
        return jsonResponse({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            protocolVersion: String(body.params?.protocolVersion ?? '2025-06-18'),
            capabilities: { tools: {} },
            serverInfo: { name: 'dashboard-mcp', version: '1.0.0' },
          },
        });
      }

      return jsonResponse({ jsonrpc: '2.0', id: body.id, result: {} });
    });

    globalThis.fetch = fetchMock as typeof fetch;

    const client = createDashboardMcpClient({ url: 'http://dashboard.test/mcp', connectTimeoutMs: 2000, toolTimeoutMs: 2000 });
    await client.connect();
    await client.disconnect();
  });
});
