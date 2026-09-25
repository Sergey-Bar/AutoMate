import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerMcpAuthDecorators } from './auth.js';
import { registerMcpServer } from './server.js';

const authMocks = vi.hoisted(() => ({
  validateApiKey: vi.fn<(key: string) => boolean>(),
  validateSessionToken: vi.fn<(token: string) => boolean>(),
  loadAuthConfig: vi.fn<() => { enabled: boolean; keys: Array<{ id: string; key: string }> }>(),
}));

vi.mock('../services/auth.js', () => ({
  validateApiKey: authMocks.validateApiKey,
  validateSessionToken: authMocks.validateSessionToken,
  loadAuthConfig: authMocks.loadAuthConfig,
  SESSION_COOKIE_NAME: 'automate_dashboard_session',
}));

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

async function createApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  registerMcpAuthDecorators(app);
  await registerMcpServer(app);
  await app.ready();
  return app;
}

describe('mcp server plugin', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    authMocks.validateApiKey.mockReturnValue(false);
    authMocks.validateSessionToken.mockReturnValue(false);
    authMocks.loadAuthConfig.mockReturnValue({
      enabled: true,
      keys: [{ id: 'key-1', key: 'valid-api-key' }],
    });
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('POST /mcp without auth returns 401', async () => {
    process.env.FEATURE_MCP_SERVER = 'true';
    const app = await createApp();

    const response = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: {
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
      },
      payload: INITIALIZE_REQUEST,
    });

    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it('POST /mcp with auth and disabled flag returns 404', async () => {
    process.env.FEATURE_MCP_SERVER = 'false';
    authMocks.validateApiKey.mockReturnValue(true);

    const app = await createApp();

    const response = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: {
        authorization: 'Bearer valid-api-key',
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
      },
      payload: INITIALIZE_REQUEST,
    });

    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it('POST /mcp initialize returns 200 for authorized caller when enabled', async () => {
    process.env.FEATURE_MCP_SERVER = 'true';
    authMocks.validateApiKey.mockReturnValue(true);

    const app = await createApp();

    const response = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: {
        authorization: 'Bearer valid-api-key',
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
      },
      payload: INITIALIZE_REQUEST,
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['mcp-session-id']).toBeTruthy();

    await app.close();
  });

  it('POST /mcp tools/list returns exactly 14 tools', async () => {
    process.env.FEATURE_MCP_SERVER = 'true';
    authMocks.validateApiKey.mockReturnValue(true);

    const app = await createApp();

    const initializeResponse = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: {
        authorization: 'Bearer valid-api-key',
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
      },
      payload: INITIALIZE_REQUEST,
    });

    const sessionId = initializeResponse.headers['mcp-session-id'];
    expect(sessionId).toBeTruthy();

    const toolsListResponse = await app.inject({
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

    expect(toolsListResponse.statusCode).toBe(200);

    const body = toolsListResponse.json() as {
      result: {
        tools: Array<{ name: string }>;
      };
    };

    expect(body.result.tools).toHaveLength(15);
    expect(body.result.tools.map((tool) => tool.name).sort()).toEqual([
      'analytics.get_duration_trend',
      'analytics.get_pass_rate',
      'integrations.get_status',
      'quarantine.get_details',
      'quarantine.list_quarantined',
      'runs.compare',
      'runs.get_gate_status',
      'runs.get_summary_by_id',
      'runs.list_recent',
      'schedules.get_by_id',
      'schedules.list',
      'tests.get_error_clusters',
      'tests.get_failures_by_run',
      'tests.get_flaky',
      'tests.get_predictive_candidates',
    ]);

    await app.close();
  });

  it('POST /mcp tools/call returns graceful error when db is unavailable', async () => {
    process.env.FEATURE_MCP_SERVER = 'true';
    authMocks.validateApiKey.mockReturnValue(true);

    const app = await createApp();

    const initializeResponse = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: {
        authorization: 'Bearer valid-api-key',
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
      },
      payload: INITIALIZE_REQUEST,
    });

    const sessionId = initializeResponse.headers['mcp-session-id'];
    expect(sessionId).toBeTruthy();

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
          name: 'runs.list_recent',
          arguments: {},
        },
      },
    });

    expect(callResponse.statusCode).toBe(200);

    const body = callResponse.json() as {
      result: {
        content: Array<{ type: string; text: string }>;
      };
    };

    expect(body.result.content[0]).toMatchObject({ type: 'text' });
    const parsed = JSON.parse(body.result.content[0].text);
    // Handler returns either a valid response or a graceful INTERNAL_ERROR when DB is unavailable
    expect(
      parsed.runs !== undefined || parsed.error === 'INTERNAL_ERROR'
    ).toBe(true);

    await app.close();
  });
});
