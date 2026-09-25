import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerMcpAuthDecorators } from '../auth.js';
import { registerMcpServer } from '../server.js';
import { McpServerRegistry } from './registry.js';
import { McpProcessLifecycle } from './lifecycle.js';
import { McpToolProxy, type McpClientConnection, type ToolCallResult } from './proxy.js';

const authMocks = vi.hoisted(() => ({
  validateApiKey: vi.fn<(key: string) => boolean>(),
  validateSessionToken: vi.fn<(token: string) => boolean>(),
  loadAuthConfig: vi.fn<() => { enabled: boolean; keys: Array<{ id: string; key: string }> }>(),
}));

vi.mock('../../services/auth.js', () => ({
  validateApiKey: authMocks.validateApiKey,
  validateSessionToken: authMocks.validateSessionToken,
  loadAuthConfig: authMocks.loadAuthConfig,
  SESSION_COOKIE_NAME: 'automate_dashboard_session',
}));

const policyMocks = vi.hoisted(() => ({
  deriveMcpPolicy: vi.fn(),
}));

vi.mock('../policy.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../policy.js')>();
  return {
    ...original,
    deriveMcpPolicy: policyMocks.deriveMcpPolicy,
  };
});

const INITIALIZE_REQUEST = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: {
      name: 'vitest-client',
      version: '1.0.0',
    },
  },
} as const;

function createMockConnection(serverId: string, toolNames: string[]): McpClientConnection {
  return {
    serverId,
    listTools: vi.fn().mockResolvedValue(
      toolNames.map((name) => ({
        name,
        description: `Mock tool ${name}`,
        inputSchema: { type: 'object', properties: {} },
      })),
    ),
    callTool: vi.fn().mockImplementation(
      async (toolName: string, _args: Record<string, unknown>): Promise<ToolCallResult> => ({
        content: [{ type: 'text', text: JSON.stringify({ tool: toolName, called: true }) }],
      }),
    ),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

async function createAppWithGateway(
  registry: McpServerRegistry,
  lifecycle: McpProcessLifecycle,
  proxy: McpToolProxy,
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  registerMcpAuthDecorators(app);
  await registerMcpServer(app, { registry, lifecycle, proxy });
  await app.ready();
  return app;
}

describe('gateway integration — registerMcpServer with external tools', () => {
  const originalEnv = process.env;

  let registry: McpServerRegistry;
  let lifecycle: McpProcessLifecycle;
  let proxy: McpToolProxy;
  let mockConnection: McpClientConnection;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv, FEATURE_MCP_SERVER: 'true' };

    authMocks.validateApiKey.mockReturnValue(true);
    authMocks.validateSessionToken.mockReturnValue(false);
    authMocks.loadAuthConfig.mockReturnValue({
      enabled: true,
      keys: [{ id: 'key-1', key: 'valid-api-key' }],
    });

    // Set up gateway components
    registry = new McpServerRegistry();
    registry.register({
      id: 'mock',
      name: 'Mock Server',
      transport: 'stdio',
      command: 'mock',
      args: [],
      enabled: true,
      toolPrefix: 'mock',
    });

    lifecycle = new McpProcessLifecycle();
    proxy = new McpToolProxy();

    // serverId must match registry id so proxy prefixes tools as 'mock.tool_a'
    mockConnection = createMockConnection('mock', ['tool_a', 'tool_b']);
    proxy.addConnection(mockConnection);

    // Policy mock: allow internal tools + external mock.* wildcard
    policyMocks.deriveMcpPolicy.mockReturnValue({
      allowedTools: [
        'runs.list_recent',
        'runs.get_summary_by_id',
        'runs.compare',
        'tests.get_failures_by_run',
        'tests.get_flaky',
        'tests.get_error_clusters',
        'tests.get_predictive_candidates',
        'analytics.get_pass_rate',
        'analytics.get_duration_trend',
        'quarantine.list_quarantined',
        'quarantine.get_details',
        'schedules.list',
        'schedules.get_by_id',
        'integrations.get_status',
        'runs.get_gate_status',
        'mock.*',
      ],
      readOnly: true,
    });
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('tools/list returns 17 tools: 15 internal + 2 external', async () => {
    const app = await createAppWithGateway(registry, lifecycle, proxy);

    // Initialize session
    const initResponse = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: {
        authorization: 'Bearer valid-api-key',
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
      },
      payload: INITIALIZE_REQUEST,
    });

    expect(initResponse.statusCode).toBe(200);
    const sessionId = initResponse.headers['mcp-session-id'];
    expect(sessionId).toBeTruthy();

    // List tools
    const toolsResponse = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: {
        authorization: 'Bearer valid-api-key',
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
        'mcp-session-id': String(sessionId),
      },
      payload: {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
        params: {},
      },
    });

    expect(toolsResponse.statusCode).toBe(200);

    const body = toolsResponse.json() as {
      result: { tools: Array<{ name: string }> };
    };

    const toolNames = body.result.tools.map((t) => t.name);

    // 15 internal + 2 external = 17
    expect(body.result.tools).toHaveLength(17);

    // External tools must be prefixed with serverId (= 'mock')
    expect(toolNames).toContain('mock.tool_a');
    expect(toolNames).toContain('mock.tool_b');

    // Internal tools still present
    expect(toolNames).toContain('runs.list_recent');
    expect(toolNames).toContain('analytics.get_pass_rate');

    await app.close();
  });

  it('tools/call for external tool delegates to proxy with correct args', async () => {
    const app = await createAppWithGateway(registry, lifecycle, proxy);

    // Initialize
    const initResponse = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: {
        authorization: 'Bearer valid-api-key',
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
      },
      payload: INITIALIZE_REQUEST,
    });

    const sessionId = initResponse.headers['mcp-session-id'];
    expect(sessionId).toBeTruthy();

    // Call external tool — note: policy mock allows mock.* via isToolAllowed from real implementation
    const callResponse = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: {
        authorization: 'Bearer valid-api-key',
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
        'mcp-session-id': String(sessionId),
      },
      payload: {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'mock.tool_a',
          arguments: { param1: 'value1' },
        },
      },
    });

    expect(callResponse.statusCode).toBe(200);

    const body = callResponse.json() as {
      result: { content: Array<{ type: string; text: string }> };
    };

    expect(body.result.content[0]).toMatchObject({ type: 'text' });

    // The proxy's callTool should have been invoked
    expect(mockConnection.callTool).toHaveBeenCalledWith(
      'tool_a',
      expect.objectContaining({ param1: 'value1' }),
    );

    await app.close();
  });

  it('onClose shuts down proxy and lifecycle', async () => {
    const closeAllSpy = vi.spyOn(proxy, 'closeAll').mockResolvedValue(undefined);
    const shutdownAllSpy = vi.spyOn(lifecycle, 'shutdownAll').mockResolvedValue(undefined);

    const app = await createAppWithGateway(registry, lifecycle, proxy);
    await app.close();

    expect(closeAllSpy).toHaveBeenCalledOnce();
    expect(shutdownAllSpy).toHaveBeenCalledOnce();
  });
});
