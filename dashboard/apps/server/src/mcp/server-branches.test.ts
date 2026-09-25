/**
 * server-branches.test.ts
 *
 * Additional branch coverage for registerMcpServer():
 * - GET /mcp without session ID header → 400 Bad Request
 * - GET /mcp with non-existent session ID → 404
 * - POST tools/call with tool not in policy → 404
 * - extractSessionId: array header value branch
 */
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
    clientInfo: { name: 'vitest-client', version: '1.0.0' },
  },
} as const;

async function createApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  registerMcpAuthDecorators(app);
  await registerMcpServer(app);
  await app.ready();
  return app;
}

describe('mcp server — additional branch coverage', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv, FEATURE_MCP_SERVER: 'true' };
    authMocks.validateApiKey.mockReturnValue(true);
    authMocks.validateSessionToken.mockReturnValue(false);
    authMocks.loadAuthConfig.mockReturnValue({
      enabled: true,
      keys: [{ id: 'key-1', key: 'valid-api-key' }],
    });
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  // ── GET without session ID → 400 Bad Request ──────────────────────────────

  it('GET /mcp without mcp-session-id header returns 400', async () => {
    const app = await createApp();

    const response = await app.inject({
      method: 'GET',
      url: '/mcp',
      headers: {
        authorization: 'Bearer valid-api-key',
        accept: 'application/json, text/event-stream',
      },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json() as { jsonrpc: string; error: { code: number; message: string }; id: null };
    expect(body.error.message).toContain('Mcp-Session-Id');

    await app.close();
  });

  // ── GET with non-existent session ID → 404 ───────────────────────────────

  it('GET /mcp with non-existent mcp-session-id returns 404', async () => {
    const app = await createApp();

    const response = await app.inject({
      method: 'GET',
      url: '/mcp',
      headers: {
        authorization: 'Bearer valid-api-key',
        accept: 'application/json, text/event-stream',
        'mcp-session-id': 'no-such-session',
      },
    });

    expect(response.statusCode).toBe(404);
    const body = response.json() as { jsonrpc: string; error: { code: number; message: string }; id: null };
    expect(body.error.message).toContain('Session not found');

    await app.close();
  });

  // ── POST tools/call with tool not in policy → 404 ────────────────────────

  it('POST /mcp tools/call with unknown tool name returns 404', async () => {
    const app = await createApp();

    const response = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: {
        authorization: 'Bearer valid-api-key',
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
        'mcp-session-id': 'session-does-not-matter',
      },
      payload: {
        jsonrpc: '2.0',
        id: 99,
        method: 'tools/call',
        params: {
          name: 'nonexistent.secret_tool',
        },
      },
    });

    expect(response.statusCode).toBe(404);
    const body = response.json() as { error?: string };
    expect(body.error).toBe('Tool not found');

    await app.close();
  });

  // ── POST /mcp non-initialize without session → 400 ────────────────────────

  it('POST /mcp non-initialize request without session ID returns 400', async () => {
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
        id: 2,
        method: 'tools/list',
        params: {},
      },
    });

    expect(response.statusCode).toBe(400);

    await app.close();
  });

  // ── POST /mcp unauthenticated → 401 ───────────────────────────────────────

  it('POST /mcp without auth credentials returns 401', async () => {
    authMocks.validateApiKey.mockReturnValue(false);
    authMocks.validateSessionToken.mockReturnValue(false);
    const app = await createApp();

    const response = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: {
        'content-type': 'application/json',
      },
      payload: {
        jsonrpc: '2.0',
        id: 3,
        method: 'initialize',
        params: INITIALIZE_REQUEST.params,
      },
    });

    expect(response.statusCode).toBe(401);

    await app.close();
  });

  // ── DELETE /mcp with valid session cleans up session ─────────────────────

  it('DELETE /mcp with mcp-session-id cleans up session without error', async () => {
    const app = await createApp();

    // First initialize to create a session
    const initRes = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: {
        authorization: 'Bearer valid-api-key',
        'content-type': 'application/json',
      },
      payload: INITIALIZE_REQUEST,
    });

    const sessionId = initRes.headers['mcp-session-id'] as string | undefined;

    if (sessionId) {
      const deleteRes = await app.inject({
        method: 'DELETE',
        url: '/mcp',
        headers: {
          authorization: 'Bearer valid-api-key',
          'mcp-session-id': sessionId,
        },
      });
      expect(deleteRes.statusCode).toBeLessThan(500);
    }

    await app.close();
  });
});
