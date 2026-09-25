import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MCP_ERROR_CODES, MCP_V1_TOOL_NAMES, getMcpV1ContractSnapshot } from './contract.js';

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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

async function callTool(app: FastifyInstance, sessionId: string, name: string, argumentsPayload: Record<string, unknown>) {
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
        arguments: argumentsPayload,
      },
    },
  });
}

describe('mcp server integration suite', () => {
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

  describe('auth', () => {
    it.each([
      {
        name: 'missing auth',
        headers: {
          accept: 'application/json, text/event-stream',
          'content-type': 'application/json',
          'mcp-session-id': 'session-1',
        },
      },
      {
        name: 'invalid bearer token',
        headers: {
          authorization: 'Bearer invalid-api-key',
          accept: 'application/json, text/event-stream',
          'content-type': 'application/json',
          'mcp-session-id': 'session-1',
        },
      },
      {
        name: 'invalid session cookie',
        headers: {
          cookie: 'automate_dashboard_session=invalid-session-token',
          accept: 'application/json, text/event-stream',
          'content-type': 'application/json',
          'mcp-session-id': 'session-1',
        },
      },
      {
        name: 'expired session credentials',
        headers: {
          cookie: 'automate_dashboard_session=key-1:expired-signature',
          accept: 'application/json, text/event-stream',
          'content-type': 'application/json',
          'mcp-session-id': 'session-1',
        },
      },
    ])('blocks unauthorized $name without tool side effects', async ({ headers }) => {
      authMocks.validateSessionToken.mockReturnValue(false);

      const app = await createApp();

      const response = await app.inject({
        method: 'POST',
        url: '/mcp',
        headers,
        payload: {
          jsonrpc: '2.0',
          id: 10,
          method: 'tools/call',
          params: {
            name: 'runs.list_recent',
            arguments: {},
          },
        },
      });

      expect(response.statusCode).toBe(401);
      expect(response.json()).toMatchObject({ code: MCP_ERROR_CODES.UNAUTHORIZED });
      expect(selectMock).not.toHaveBeenCalled();
      expect(clusterErrorsMock).not.toHaveBeenCalled();
      expect(predictiveCandidatesMock).not.toHaveBeenCalled();

      await app.close();
    });

    it('returns 404 when MCP feature flag is disabled', async () => {
      process.env.FEATURE_MCP_SERVER = 'false';
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
      expect(response.json()).toMatchObject({
        error: 'MCP server is disabled',
        code: MCP_ERROR_CODES.FEATURE_DISABLED,
      });

      await app.close();
    });
  });

  describe('lifecycle', () => {
    it('initializes session and negotiates protocol version compatibility', async () => {
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

      const body = response.json() as {
        result?: {
          protocolVersion?: string;
        };
      };
      expect(typeof body.result?.protocolVersion).toBe('string');

      await app.close();
    });

    it('requires session id for non-initialize requests', async () => {
      const app = await createApp();

      const response = await app.inject({
        method: 'POST',
        url: '/mcp',
        headers: {
          authorization: 'Bearer valid-api-key',
          accept: 'application/json, text/event-stream',
          'content-type': 'application/json',
        },
        payload: {
          jsonrpc: '2.0',
          id: 20,
          method: 'tools/list',
          params: {},
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        error: {
          code: -32000,
          message: 'Bad Request: Mcp-Session-Id header is required',
        },
      });

      await app.close();
    });

    it('returns session not found for invalid session id', async () => {
      const app = await createApp();

      const response = await app.inject({
        method: 'POST',
        url: '/mcp',
        headers: {
          authorization: 'Bearer valid-api-key',
          accept: 'application/json, text/event-stream',
          'content-type': 'application/json',
          'mcp-session-id': 'does-not-exist',
        },
        payload: {
          jsonrpc: '2.0',
          id: 21,
          method: 'tools/list',
          params: {},
        },
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({
        error: {
          code: -32001,
          message: 'Session not found',
        },
      });

      await app.close();
    });
  });

  describe('tools', () => {
    it('tools/list returns exactly contract tool names', async () => {
      const app = await createApp();
      const sessionId = await initializeSession(app);

      const response = await listTools(app, sessionId);
      expect(response.statusCode).toBe(200);

      const body = response.json() as {
        result: {
          tools: Array<{ name: string }>;
        };
      };

      const names = body.result.tools.map((tool) => tool.name).sort();
      expect(names).toEqual([...MCP_V1_TOOL_NAMES].sort());
      expect(names).toHaveLength(15);

      await app.close();
    });

    it('blocks tools outside allowlist with 404', async () => {
      const app = await createApp();
      const sessionId = await initializeSession(app);

      const response = await callTool(app, sessionId, 'admin.delete_everything', {});
      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({
        error: 'Tool not found',
        code: MCP_ERROR_CODES.TOOL_NOT_FOUND,
      });

      await app.close();
    });

    it.each([
      {
        toolName: 'runs.list_recent',
        args: {},
        configureMocks: () => {
          selectMock.mockReturnValueOnce(createQueryBuilder([
            {
              id: 'run-1',
              branch: 'main',
              status: 'passed',
              startedAt: '2026-03-20T00:00:00.000Z',
              durationMs: 1200,
              total: 10,
              passed: 9,
              failed: 1,
            },
          ]));
        },
        assertion: (value: unknown) => {
          expect(value).toMatchObject({ runs: expect.any(Array) });
        },
      },
      {
        toolName: 'runs.get_summary_by_id',
        args: { runId: 'run-42' },
        configureMocks: () => {
          selectMock
            .mockReturnValueOnce(createQueryBuilder([
              {
                id: 'run-42',
                branch: 'main',
                status: 'failed',
                startedAt: '2026-03-21T00:00:00.000Z',
                durationMs: 3300,
                total: 12,
                passed: 8,
                failed: 4,
                skipped: 0,
                config: JSON.stringify({ environment: 'ci' }),
              },
            ]))
            .mockReturnValueOnce(createQueryBuilder([{ count: 5 }]));
        },
        assertion: (value: unknown) => {
          expect(value).toMatchObject({ run: expect.any(Object) });
        },
      },
      {
        toolName: 'tests.get_failures_by_run',
        args: { runId: 'run-42' },
        configureMocks: () => {
          selectMock.mockReturnValueOnce(createQueryBuilder([
            {
              testId: 'test-1',
              title: 'fails',
              file: 'suite/a.spec.ts',
              errorMessage: 'boom',
              errorStack: 'stack',
              durationMs: 25,
            },
          ]));
        },
        assertion: (value: unknown) => {
          expect(value).toMatchObject({ failures: expect.any(Array) });
        },
      },
      {
        toolName: 'analytics.get_pass_rate',
        args: {},
        configureMocks: () => {
          selectMock
            .mockReturnValueOnce(createQueryBuilder([{ date: '2026-03-20', passed: 8, total: 10 }]))
            .mockReturnValueOnce(createQueryBuilder([{ value: 1 }]));
        },
        assertion: (value: unknown) => {
          expect(value).toMatchObject({ passRate: expect.any(Number), totalRuns: expect.any(Number) });
        },
      },
      {
        toolName: 'analytics.get_duration_trend',
        args: {},
        configureMocks: () => {
          selectMock.mockReturnValueOnce(createQueryBuilder([{ date: '2026-03-20', durationMs: 100 }]));
        },
        assertion: (value: unknown) => {
          expect(value).toMatchObject({ trend: expect.any(Array) });
        },
      },
      {
        toolName: 'tests.get_error_clusters',
        args: { runId: 'run-42' },
        configureMocks: () => {
          clusterErrorsMock.mockResolvedValueOnce([
            {
              clusterId: 'cluster-1',
              sampleError: 'Timeout',
              sampleStack: 'stack',
              testIds: ['t1', 't2'],
              count: 2,
            },
          ]);
        },
        assertion: (value: unknown) => {
          expect(value).toMatchObject({ clusters: expect.any(Array) });
        },
      },
      {
        toolName: 'tests.get_predictive_candidates',
        args: { changedFiles: ['src/a.ts'] },
        configureMocks: () => {
          predictiveCandidatesMock.mockResolvedValueOnce({
            candidates: [{ testFile: 'a.spec.ts', title: 'A', score: 0.9, reason: 'changed import' }],
            mode: 'full',
            totalHistoricalRuns: 200,
            coldStartThreshold: 20,
          });
        },
        assertion: (value: unknown) => {
          expect(value).toMatchObject({ candidates: expect.any(Array), mode: expect.any(String) });
        },
      },
    ])('tools/call returns valid response shape for $toolName', async ({ toolName, args, configureMocks, assertion }) => {
      const app = await createApp();
      const sessionId = await initializeSession(app);
      configureMocks();

      const response = await callTool(app, sessionId, toolName, args);
      expect(response.statusCode).toBe(200);

      const body = response.json() as {
        result: {
          content: Array<{ type: string; text: string }>;
        };
      };

      expect(body.result.content[0]).toMatchObject({ type: 'text' });
      const parsed = JSON.parse(body.result.content[0].text) as unknown;
      assertion(parsed);

      await app.close();
    });
  });

  describe('contract', () => {
    it('matches v1 contract snapshot fixture to detect schema drift', () => {
      const fixturePath = path.resolve(__dirname, '__fixtures__', 'contract-v1-snapshot.json');
      const fixture = JSON.parse(readFileSync(fixturePath, 'utf-8')) as ReturnType<typeof getMcpV1ContractSnapshot>;
      const snapshot = getMcpV1ContractSnapshot();
      expect(snapshot).toEqual(fixture);
    });
  });

  describe('churn', () => {
    it('survives repeated connect/list/disconnect cycles without stale sessions', async () => {
      const app = await createApp();

      for (let i = 0; i < 6; i += 1) {
        const sessionId = await initializeSession(app);
        const listResponse = await listTools(app, sessionId);
        expect(listResponse.statusCode).toBe(200);

        const disconnectResponse = await app.inject({
          method: 'DELETE',
          url: '/mcp',
          headers: {
            authorization: 'Bearer valid-api-key',
            accept: 'application/json, text/event-stream',
            'mcp-session-id': sessionId,
          },
        });

        expect(disconnectResponse.statusCode).toBe(200);

        const afterDeleteResponse = await listTools(app, sessionId);
        expect(afterDeleteResponse.statusCode).toBe(404);
        expect(afterDeleteResponse.json()).toMatchObject({
          error: {
            code: -32001,
            message: 'Session not found',
          },
        });
      }

      await expect(app.close()).resolves.toBeUndefined();
    });
  });
});
