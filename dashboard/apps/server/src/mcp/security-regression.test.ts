import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MCP_ERROR_CODES, MCP_V1_TOOL_NAMES } from './contract.js';

const authMocks = vi.hoisted(() => ({
  validateApiKey: vi.fn<(key: string) => boolean>(),
  validateSessionToken: vi.fn<(token: string) => boolean>(),
  loadAuthConfig: vi.fn<() => { enabled: boolean; keys: Array<{ id: string; key: string }> }>(),
}));

type QueryBuilder<T> = Promise<T> & {
  from: ReturnType<typeof vi.fn>;
  where: ReturnType<typeof vi.fn>;
  orderBy: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
  groupBy: ReturnType<typeof vi.fn>;
  innerJoin: ReturnType<typeof vi.fn>;
};

const selectMock = vi.hoisted(() => vi.fn());
const insertMock = vi.hoisted(() => vi.fn());
const clusterErrorsMock = vi.hoisted(() => vi.fn());
const predictiveCandidatesMock = vi.hoisted(() => vi.fn());

vi.mock('../services/auth.js', () => ({
  validateApiKey: authMocks.validateApiKey,
  validateSessionToken: authMocks.validateSessionToken,
  loadAuthConfig: authMocks.loadAuthConfig,
  SESSION_COOKIE_NAME: 'automate_dashboard_session',
}));

vi.mock('../db/client.js', () => ({
  db: {
    select: selectMock,
    insert: insertMock,
  },
  sqlite: { prepare: vi.fn() },
  poolConnection: { query: vi.fn() },
  isPostgres: false,
}));

vi.mock('../services/error-clustering.js', () => ({
  clusterErrors: clusterErrorsMock,
}));

vi.mock('../services/predictive-selection.js', () => ({
  getPredictiveCandidates: predictiveCandidatesMock,
}));

import { registerMcpAuthDecorators } from './auth.js';
import { registerMcpServer } from './server.js';

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

function createQueryBuilder<T>(rows: T): QueryBuilder<T> {
  const builder = Promise.resolve(rows) as QueryBuilder<T>;
  builder.from = vi.fn(() => builder);
  builder.where = vi.fn(() => builder);
  builder.orderBy = vi.fn(() => builder);
  builder.limit = vi.fn(() => builder);
  builder.groupBy = vi.fn(() => builder);
  builder.innerJoin = vi.fn(() => builder);
  return builder;
}

async function createApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  registerMcpAuthDecorators(app);
  await registerMcpServer(app);
  await app.ready();
  return app;
}

async function initializeSession(app: FastifyInstance): Promise<string> {
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

  expect(initializeResponse.statusCode).toBe(200);
  const sessionId = initializeResponse.headers['mcp-session-id'];
  expect(typeof sessionId).toBe('string');
  return String(sessionId);
}

async function listTools(app: FastifyInstance, sessionId: string) {
  return app.inject({
    method: 'POST',
    url: '/mcp',
    headers: {
      authorization: 'Bearer valid-api-key',
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
      'mcp-session-id': sessionId,
    },
    payload: {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {},
    },
  });
}

describe('mcp security regression suite', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv, FEATURE_MCP_SERVER: 'true' };

    authMocks.validateApiKey.mockImplementation((key) => key === 'valid-api-key');
    authMocks.validateSessionToken.mockReturnValue(false);
    authMocks.loadAuthConfig.mockReturnValue({
      enabled: true,
      keys: [{ id: 'key-1', key: 'valid-api-key' }],
    });

    selectMock.mockReturnValue(createQueryBuilder([]));
    insertMock.mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });
    clusterErrorsMock.mockResolvedValue([]);
    predictiveCandidatesMock.mockResolvedValue({
      candidates: [],
      mode: 'static_only',
      totalHistoricalRuns: 0,
      coldStartThreshold: 20,
    });
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('rejects unauthorized requests without Bearer token', async () => {
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
    expect(response.json()).toMatchObject({
      error: 'Unauthorized',
      code: MCP_ERROR_CODES.UNAUTHORIZED,
    });
    expect(selectMock).not.toHaveBeenCalled();

    await app.close();
  });

  it('rejects invalid API key Bearer credentials', async () => {
    const app = await createApp();

    const response = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: {
        authorization: 'Bearer invalid-api-key',
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
      },
      payload: INITIALIZE_REQUEST,
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      error: 'Unauthorized',
      code: MCP_ERROR_CODES.UNAUTHORIZED,
    });
    expect(selectMock).not.toHaveBeenCalled();

    await app.close();
  });

  it('denies policy-violating tool calls outside the allowlist', async () => {
    const app = await createApp();
    const sessionId = await initializeSession(app);

    const response = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: {
        authorization: 'Bearer valid-api-key',
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
        'mcp-session-id': sessionId,
      },
      payload: {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'admin.delete_everything',
          arguments: {},
        },
      },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      error: 'Tool not found',
      code: MCP_ERROR_CODES.TOOL_NOT_FOUND,
    });
    expect(selectMock).not.toHaveBeenCalled();

    await app.close();
  });

  it('detects contract mismatch when discovered tools miss a required tool', async () => {
    const app = await createApp();
    const sessionId = await initializeSession(app);

    const listResponse = await listTools(app, sessionId);
    expect(listResponse.statusCode).toBe(200);

    const body = listResponse.json() as {
      result: {
        tools: Array<{ name: string }>;
      };
    };
    const discoveredNames = body.result.tools.map((tool) => tool.name);
    const simulatedMismatch = discoveredNames.filter((name) => name !== 'tests.get_predictive_candidates');

    expect(discoveredNames.sort()).toEqual([...MCP_V1_TOOL_NAMES].sort());
    expect(simulatedMismatch).not.toEqual([...MCP_V1_TOOL_NAMES]);

    const missingFromDiscovery = MCP_V1_TOOL_NAMES.filter((tool) => !simulatedMismatch.includes(tool));
    expect(missingFromDiscovery).toEqual(['tests.get_predictive_candidates']);

    await app.close();
  });
});
