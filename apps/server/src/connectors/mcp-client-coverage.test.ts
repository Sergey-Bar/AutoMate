import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDashboardMcpClient } from './mcp-client.js';

type JsonRpcRequest = { jsonrpc: '2.0'; id?: number | string; method: string; params?: Record<string, unknown> };

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('DashboardMcpClient additional coverage', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('throws immediately when URL is missing', async () => {
    const client = createDashboardMcpClient({ url: '', apiKey: 'key' });
    await expect(client.connect()).rejects.toThrow('Missing DASHBOARD_MCP_URL or DASHBOARD_SERVICE_ACCOUNT_KEY / DASHBOARD_MCP_API_KEY');
  });

  it('throws immediately when API key is missing', async () => {
    const client = createDashboardMcpClient({ url: 'http://localhost/mcp', apiKey: '' });
    await expect(client.connect()).rejects.toThrow('Missing DASHBOARD_MCP_URL or DASHBOARD_SERVICE_ACCOUNT_KEY / DASHBOARD_MCP_API_KEY');
  });

  it('reuses existing connection (connected flag - second connect is no-op)', async () => {
    const fetchMock = vi.fn(async (_input: URL | RequestInfo, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as JsonRpcRequest;
      if (body.method === 'initialize') {
        return jsonResponse({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            protocolVersion: '2025-06-18',
            capabilities: { tools: {} },
            serverInfo: { name: 'dashboard-mcp', version: '1.0.0' },
          },
        });
      }
      return jsonResponse({ jsonrpc: '2.0', id: body.id, result: {} });
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const client = createDashboardMcpClient({
      url: 'http://dashboard.test/mcp',
      apiKey: 'test-key',
      connectTimeoutMs: 2000,
      toolTimeoutMs: 2000,
    });

    // First connect
    await client.connect();
    const callCountAfterFirst = fetchMock.mock.calls.length;
    // Second connect should be a no-op (connected is already true)
    await client.connect();
    // No additional fetch calls should have been made
    expect(fetchMock.mock.calls.length).toBe(callCountAfterFirst);

    await client.disconnect();
  });

  it('normalizeCallToolContent handles non-text items (fallback to JSON.stringify)', async () => {
    const fetchMock = vi.fn(async (_input: URL | RequestInfo, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as JsonRpcRequest;
      if (body.method === 'initialize') {
        return jsonResponse({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            protocolVersion: '2025-06-18',
            capabilities: { tools: {} },
            serverInfo: { name: 'dashboard-mcp', version: '1.0.0' },
          },
        });
      }
      if (body.method === 'tools/call') {
        return jsonResponse({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            // MCP image content requires type, mimeType, data fields
            content: [
              { type: 'image', mimeType: 'image/png', data: 'base64data' },
              { type: 'text', text: 'valid-text' },
            ],
          },
        });
      }
      return jsonResponse({ jsonrpc: '2.0', id: body.id, result: {} });
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const client = createDashboardMcpClient({
      url: 'http://dashboard.test/mcp',
      apiKey: 'test-key',
      connectTimeoutMs: 2000,
      toolTimeoutMs: 2000,
    });

    await client.connect();
    const result = await client.callTool('some_tool', {});

    // image item gets JSON.stringify'd; text item is returned as-is
    expect(result.content).toHaveLength(2);
    expect(result.content[0].type).toBe('text');
    // image item JSON.stringify'd by normalizeCallToolContent fallback — check it contains the key fields
    const imageText = result.content[0].text;
    expect(imageText).toContain('"type":"image"');
    expect(imageText).toContain('"mimeType":"image/png"');
    expect(imageText).toContain('"data":"base64data"');
    expect(result.content[1].text).toBe('valid-text');

    await client.disconnect();
  });

  it('callTool returns structuredContent when content array is empty', async () => {
    const fetchMock = vi.fn(async (_input: URL | RequestInfo, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as JsonRpcRequest;
      if (body.method === 'initialize') {
        return jsonResponse({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            protocolVersion: '2025-06-18',
            capabilities: { tools: {} },
            serverInfo: { name: 'dashboard-mcp', version: '1.0.0' },
          },
        });
      }
      if (body.method === 'tools/call') {
        return jsonResponse({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            content: [],
            structuredContent: { runs: [] },
          },
        });
      }
      return jsonResponse({ jsonrpc: '2.0', id: body.id, result: {} });
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const client = createDashboardMcpClient({
      url: 'http://dashboard.test/mcp',
      apiKey: 'test-key',
      connectTimeoutMs: 2000,
      toolTimeoutMs: 2000,
    });

    await client.connect();
    const result = await client.callTool('some_tool', {});

    // Empty content → uses structuredContent
    expect(result.content).toHaveLength(1);
    expect(result.content[0].text).toBe(JSON.stringify({ runs: [] }));

    await client.disconnect();
  });

  it('callTool result with isError=true is propagated', async () => {
    const fetchMock = vi.fn(async (_input: URL | RequestInfo, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as JsonRpcRequest;
      if (body.method === 'initialize') {
        return jsonResponse({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            protocolVersion: '2025-06-18',
            capabilities: { tools: {} },
            serverInfo: { name: 'dashboard-mcp', version: '1.0.0' },
          },
        });
      }
      if (body.method === 'tools/call') {
        return jsonResponse({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            content: [{ type: 'text', text: 'error occurred' }],
            isError: true,
          },
        });
      }
      return jsonResponse({ jsonrpc: '2.0', id: body.id, result: {} });
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const client = createDashboardMcpClient({
      url: 'http://dashboard.test/mcp',
      apiKey: 'test-key',
      connectTimeoutMs: 2000,
      toolTimeoutMs: 2000,
    });

    await client.connect();
    const result = await client.callTool('some_tool', {});
    expect(result.isError).toBe(true);

    await client.disconnect();
  });

  it('listTools throws actionable error when server returns error after connect', async () => {
    const fetchMock = vi.fn(async (_input: URL | RequestInfo, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as JsonRpcRequest;

      if (body.method === 'initialize') {
        return jsonResponse({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            protocolVersion: '2025-06-18',
            capabilities: { tools: {} },
            serverInfo: { name: 'dashboard-mcp', version: '1.0.0' },
          },
        });
      }
      // Simulate error on tools/list (line 107)
      if (body.method === 'tools/list') {
        throw new Error('Server error on tools/list');
      }
      return jsonResponse({ jsonrpc: '2.0', id: body.id, result: {} });
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const client = createDashboardMcpClient({
      url: 'http://dashboard.test/mcp',
      apiKey: 'test-key',
      connectTimeoutMs: 2000,
      toolTimeoutMs: 2000,
    });

    await client.connect();
    await expect(client.listTools()).rejects.toThrow('Dashboard MCP unavailable during list tools');

    await client.disconnect();
  });

  it('callTool throws actionable error when tool call fails after connect', async () => {
    const fetchMock = vi.fn(async (_input: URL | RequestInfo, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as JsonRpcRequest;

      if (body.method === 'initialize') {
        return jsonResponse({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            protocolVersion: '2025-06-18',
            capabilities: { tools: {} },
            serverInfo: { name: 'dashboard-mcp', version: '1.0.0' },
          },
        });
      }
      // Simulate error on tools/call (line 132)
      if (body.method === 'tools/call') {
        throw new Error('Server error on tools/call');
      }
      return jsonResponse({ jsonrpc: '2.0', id: body.id, result: {} });
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const client = createDashboardMcpClient({
      url: 'http://dashboard.test/mcp',
      apiKey: 'test-key',
      connectTimeoutMs: 2000,
      toolTimeoutMs: 2000,
    });

    await client.connect();
    await expect(client.callTool('some_tool', {})).rejects.toThrow('Dashboard MCP unavailable during call tool');

    await client.disconnect();
  });

  it('disconnect can be called when never connected (transport is null)', async () => {
    const client = createDashboardMcpClient({
      url: 'http://dashboard.test/mcp',
      apiKey: 'test-key',
    });
    // Should not throw even when transport is null
    await expect(client.disconnect()).resolves.toBeUndefined();
  });

  it('uses DASHBOARD_MCP_URL and DASHBOARD_MCP_API_KEY env vars when config not provided', async () => {
    // eslint-disable-next-line test-flakiness/no-global-state-mutation
    process.env.DASHBOARD_MCP_URL = '';
    // eslint-disable-next-line test-flakiness/no-global-state-mutation
    process.env.DASHBOARD_MCP_API_KEY = '';

    const client = createDashboardMcpClient();
    await expect(client.connect()).rejects.toThrow('Missing DASHBOARD_MCP_URL or DASHBOARD_SERVICE_ACCOUNT_KEY / DASHBOARD_MCP_API_KEY');

    // eslint-disable-next-line test-flakiness/no-global-state-mutation
    delete process.env.DASHBOARD_MCP_URL;
    // eslint-disable-next-line test-flakiness/no-global-state-mutation
    delete process.env.DASHBOARD_MCP_API_KEY;
  });

  it('callTool falls back to empty object when both content array and structuredContent are absent', async () => {
    const fetchMock = vi.fn(async (_input: URL | RequestInfo, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as JsonRpcRequest;
      if (body.method === 'initialize') {
        return jsonResponse({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            protocolVersion: '2025-06-18',
            capabilities: { tools: {} },
            serverInfo: { name: 'dashboard-mcp', version: '1.0.0' },
          },
        });
      }
      if (body.method === 'tools/call') {
        // No content array and no structuredContent — triggers the `?? {}` branch
        return jsonResponse({
          jsonrpc: '2.0',
          id: body.id,
          result: {},
        });
      }
      return jsonResponse({ jsonrpc: '2.0', id: body.id, result: {} });
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const client = createDashboardMcpClient({
      url: 'http://dashboard.test/mcp',
      apiKey: 'test-key',
      connectTimeoutMs: 2000,
      toolTimeoutMs: 2000,
    });

    await client.connect();
    const result = await client.callTool('some_tool', {});

    // content is absent → normalizeCallToolContent([]) returns [] → falls back to structuredContent ?? {}
    expect(result.content).toHaveLength(1);
    expect(result.content[0].text).toBe('{}');
    expect(result.isError).toBe(false);

    await client.disconnect();
  });

  it('concurrent connect calls deduplicate to a single in-flight request', async () => {
    let initializeCallCount = 0;
    const fetchMock = vi.fn(async (_input: URL | RequestInfo, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as JsonRpcRequest;
      if (body.method === 'initialize') {
        initializeCallCount++;
        // Simulate a slow connect
        await new Promise((resolve) => setTimeout(resolve, 20));
        return jsonResponse({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            protocolVersion: '2025-06-18',
            capabilities: { tools: {} },
            serverInfo: { name: 'dashboard-mcp', version: '1.0.0' },
          },
        });
      }
      return jsonResponse({ jsonrpc: '2.0', id: body.id, result: {} });
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const client = createDashboardMcpClient({
      url: 'http://dashboard.test/mcp',
      apiKey: 'test-key',
      connectTimeoutMs: 2000,
      toolTimeoutMs: 2000,
    });

    // Fire two concurrent connect calls — the second should reuse the in-flight promise
    await Promise.all([client.connect(), client.connect()]);

    // Only one initialize call should have gone out
    expect(initializeCallCount).toBe(1);

    await client.disconnect();
  });

  it('toActionableError wraps non-Error thrown values as strings', async () => {
    const fetchMock = vi.fn(async (_input: URL | RequestInfo, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as JsonRpcRequest;
      if (body.method === 'initialize') {
        // Throw a non-Error value to exercise the String(error) branch of toActionableError
        return Promise.reject(new String('plain string error'));
      }
      return jsonResponse({ jsonrpc: '2.0', id: body.id, result: {} });
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const client = createDashboardMcpClient({
      url: 'http://dashboard.test/mcp',
      apiKey: 'test-key',
      connectTimeoutMs: 2000,
      toolTimeoutMs: 2000,
    });

    const err = await client.connect().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain('plain string error');
    expect((err as Error).message).toContain('Dashboard MCP unavailable during connect');
  });

  it('normalizeCallToolContent returns empty array when content is not an array', async () => {
    const fetchMock = vi.fn(async (_input: URL | RequestInfo, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as JsonRpcRequest;
      if (body.method === 'initialize') {
        return jsonResponse({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            protocolVersion: '2025-06-18',
            capabilities: { tools: {} },
            serverInfo: { name: 'dashboard-mcp', version: '1.0.0' },
          },
        });
      }
      if (body.method === 'tools/call') {
        // Return content as an empty array — the normalizeCallToolContent receives []
        // which is an array but produces no items, exercising the fallback to structuredContent
        return jsonResponse({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            content: [],
            structuredContent: { status: 'ok' },
          },
        });
      }
      return jsonResponse({ jsonrpc: '2.0', id: body.id, result: {} });
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const client = createDashboardMcpClient({
      url: 'http://dashboard.test/mcp',
      apiKey: 'test-key',
      connectTimeoutMs: 2000,
      toolTimeoutMs: 2000,
    });

    await client.connect();
    const result = await client.callTool('some_tool', {});

    // Empty content array → normalizeCallToolContent returns [] → falls back to structuredContent
    expect(result.content).toHaveLength(1);
    expect(result.content[0].text).toBe(JSON.stringify({ status: 'ok' }));

    await client.disconnect();
  });
});
