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
  const sessionId = response.headers['mcp-session-id'];
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

async function callTool(app: FastifyInstance, sessionId: string, name: string) {
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
      id: 3,
      method: 'tools/call',
      params: {
        name,
        arguments: {},
      },
    },
  });
}

async function disconnect(app: FastifyInstance, sessionId: string) {
  return app.inject({
    method: 'DELETE',
    url: '/mcp',
    headers: {
      authorization: 'Bearer valid-api-key',
      accept: 'application/json, text/event-stream',
      'mcp-session-id': sessionId,
    },
  });
}

describe('mcp churn lifecycle', () => {
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

  it('runs connect → list → call → disconnect with idempotent tool discovery', async () => {
    const app = await createApp();
    const sessionId = await initializeSession(app);

    const firstList = await listTools(app, sessionId);
    const secondList = await listTools(app, sessionId);

    expect(firstList.statusCode).toBe(200);
    expect(secondList.statusCode).toBe(200);

    const firstBody = firstList.json() as {
      result: {
        tools: Array<{ name: string }>;
      };
    };
    const secondBody = secondList.json() as {
      result: {
        tools: Array<{ name: string }>;
      };
    };

    const firstNames = firstBody.result.tools.map((tool) => tool.name).sort();
    const secondNames = secondBody.result.tools.map((tool) => tool.name).sort();

    expect(firstNames).toEqual([...MCP_V1_TOOL_NAMES].sort());
    expect(firstNames).toHaveLength(15);
    expect(secondNames).toEqual(firstNames);

    const validCall = await callTool(app, sessionId, 'runs.list_recent');
    expect(validCall.statusCode).toBe(200);

    const validBody = validCall.json() as {
      result: {
        content: Array<{ type: string; text: string }>;
      };
    };

    expect(validBody.result.content[0]).toMatchObject({ type: 'text' });
    expect(JSON.parse(validBody.result.content[0].text)).toMatchObject({ runs: expect.any(Array) });

    const unknownCall = await callTool(app, sessionId, 'unknown.tool');
    expect(unknownCall.statusCode).toBe(404);
    expect(unknownCall.json()).toMatchObject({
      error: 'Tool not found',
      code: MCP_ERROR_CODES.TOOL_NOT_FOUND,
    });

    const disconnected = await disconnect(app, sessionId);
    expect(disconnected.statusCode).toBe(200);

    const listAfterDisconnect = await listTools(app, sessionId);
    expect(listAfterDisconnect.statusCode).toBe(404);
    expect(listAfterDisconnect.json()).toMatchObject({
      error: {
        code: -32001,
        message: 'Session not found',
      },
    });

    await app.close();
  });
});
