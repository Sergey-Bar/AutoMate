import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { MCP_ERROR_CODES } from './contract.js';
import { mcpAuthHook, registerMcpAuthDecorators, extractMcpAuthContext } from './auth.js';

const authMocks = vi.hoisted(() => ({
  validateApiKey: vi.fn<(key: string) => boolean>(),
  validateSessionToken: vi.fn<(token: string) => boolean>(),
  loadAuthConfig: vi.fn<() => { keys: Array<{ id: string; key: string }>; enabled: boolean }>(),
}));

const featureFlagsMocks = vi.hoisted(() => ({
  isEnabled: vi.fn<(name: string) => boolean>(),
}));

const auditMocks = vi.hoisted(() => ({
  logAuditEvent: vi.fn(),
}));

vi.mock('../services/auth.js', () => ({
  validateApiKey: authMocks.validateApiKey,
  validateSessionToken: authMocks.validateSessionToken,
  loadAuthConfig: authMocks.loadAuthConfig,
  SESSION_COOKIE_NAME: 'automate_dashboard_session',
}));

vi.mock('../services/feature-flags.js', () => ({
  isEnabled: featureFlagsMocks.isEnabled,
}));

vi.mock('../services/audit.js', () => ({
  logAuditEvent: auditMocks.logAuditEvent,
}));

function makeRequest(partial: {
  authorization?: string;
  cookieToken?: string;
  mcpAuthContext?: unknown;
  mcpPolicy?: unknown;
} = {}): FastifyRequest {
  return {
    headers: partial.authorization ? { authorization: partial.authorization } : {},
    cookies: partial.cookieToken ? { automate_dashboard_session: partial.cookieToken } : {},
    mcpAuthContext: partial.mcpAuthContext,
    mcpPolicy: partial.mcpPolicy,
    server: {
      log: {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
      },
    },
  } as unknown as FastifyRequest;
}

function makeReply() {
  const send = vi.fn<(payload: unknown) => unknown>();
  const status = vi.fn((_: number) => ({ send }));
  return { send, status, reply: { status } as unknown as FastifyReply };
}

describe('mcp auth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.DASHBOARD_SERVICE_ACCOUNT_KEY;
    authMocks.loadAuthConfig.mockReturnValue({
      enabled: true,
      keys: [
        { id: 'api-key-1', key: 'secret-key-1' },
        { id: 'api-key-2', key: 'secret-key-2' },
      ],
    });
    featureFlagsMocks.isEnabled.mockReturnValue(true);
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.DASHBOARD_SERVICE_ACCOUNT_KEY;
  });

  describe('extractMcpAuthContext', () => {
    it('returns null for missing auth header and missing session cookie', () => {
      const request = makeRequest();

      const result = extractMcpAuthContext(request);

      expect(result).toBeNull();
    });

    it('returns null for invalid API key', () => {
      authMocks.validateApiKey.mockReturnValue(false);
      const request = makeRequest({ authorization: 'Bearer invalid-key' });

      const result = extractMcpAuthContext(request);

      expect(result).toBeNull();
    });

    it('returns null when authorization header is not Bearer format (e.g. Basic auth)', () => {
      const request = makeRequest({ authorization: 'Basic dXNlcjpwYXNz' });

      const result = extractMcpAuthContext(request);

      expect(result).toBeNull();
      expect(authMocks.validateApiKey).not.toHaveBeenCalled();
    });

    it('returns null when Bearer token is empty string after trim', () => {
      // "Bearer " with only whitespace — match[1].trim() is empty → token is falsy
      const request = makeRequest({ authorization: 'Bearer   ' });

      const result = extractMcpAuthContext(request);

      expect(result).toBeNull();
    });

    it('returns null when API key validates but is not found in config keys', () => {
      // validateApiKey passes but findApiKeyActor returns null (key not in config)
      authMocks.validateApiKey.mockReturnValue(true);
      authMocks.loadAuthConfig.mockReturnValue({ enabled: true, keys: [] });

      const request = makeRequest({ authorization: 'Bearer some-valid-key' });

      const result = extractMcpAuthContext(request);

      expect(result).toBeNull();
    });

    it('returns null when session token has empty keyId segment', () => {
      // Token starts with ":" so split(":")[0] is "" → extractSessionActor returns null
      authMocks.validateSessionToken.mockReturnValue(true);
      const request = makeRequest({ cookieToken: ':rest-of-token' });

      const result = extractMcpAuthContext(request);

      expect(result).toBeNull();
    });

    it('returns context with actorType "user" for valid API key not matching service account key', () => {
      authMocks.validateApiKey.mockReturnValue(true);
      const request = makeRequest({ authorization: 'Bearer secret-key-2' });

      const result = extractMcpAuthContext(request);

      expect(result).not.toBeNull();
      expect(result).toMatchObject({ actor: 'api-key-2', source: 'api_key', actorType: 'user' });
      expect(typeof result?.authenticatedAt).toBe('string');
    });

    it('returns context with actorType "service" when key matches DASHBOARD_SERVICE_ACCOUNT_KEY', () => {
      process.env.DASHBOARD_SERVICE_ACCOUNT_KEY = 'secret-key-1';
      authMocks.validateApiKey.mockReturnValue(true);
      const request = makeRequest({ authorization: 'Bearer secret-key-1' });

      const result = extractMcpAuthContext(request);

      expect(result).not.toBeNull();
      expect(result).toMatchObject({ actor: 'api-key-1', source: 'api_key', actorType: 'service' });
    });

    it('returns context with actorType "user" when DASHBOARD_SERVICE_ACCOUNT_KEY is not set', () => {
      // Env var absent → any valid API key is treated as a user key
      authMocks.validateApiKey.mockReturnValue(true);
      const request = makeRequest({ authorization: 'Bearer secret-key-1' });

      const result = extractMcpAuthContext(request);

      expect(result).not.toBeNull();
      expect(result).toMatchObject({ actor: 'api-key-1', source: 'api_key', actorType: 'user' });
    });

    it('returns context with actorType "user" for valid session cookie', () => {
      authMocks.validateSessionToken.mockReturnValue(true);
      const request = makeRequest({ cookieToken: 'session-key-7:123456789:sig' });

      const result = extractMcpAuthContext(request);

      expect(result).not.toBeNull();
      expect(result).toMatchObject({ actor: 'session-key-7', source: 'session', actorType: 'user' });
      expect(typeof result?.authenticatedAt).toBe('string');
    });
  });

  describe('registerMcpAuthDecorators', () => {
    it('decorates fastify request with mcp auth fields', () => {
      const decorateRequest = vi.fn();
      const app = { decorateRequest };

      registerMcpAuthDecorators(app as unknown as Parameters<typeof registerMcpAuthDecorators>[0]);

      expect(decorateRequest).toHaveBeenCalledWith('mcpAuthContext', null);
      expect(decorateRequest).toHaveBeenCalledWith('mcpPolicy', null);
    });
  });

  describe('mcpAuthHook', () => {
    it('returns 401 with UNAUTHORIZED when auth is missing', async () => {
      const request = makeRequest();
      const { reply, status, send } = makeReply();

      await mcpAuthHook(request, reply);

      expect(status).toHaveBeenCalledWith(401);
      expect(send).toHaveBeenCalledWith({
        error: 'Unauthorized',
        code: MCP_ERROR_CODES.UNAUTHORIZED,
      });
    });

    it('returns 404 with FEATURE_DISABLED when mcp-server flag is disabled', async () => {
      featureFlagsMocks.isEnabled.mockReturnValue(false);
      authMocks.validateApiKey.mockReturnValue(true);
      const request = makeRequest({ authorization: 'Bearer secret-key-1' });
      const { reply, status, send } = makeReply();

      await mcpAuthHook(request, reply);

      expect(status).toHaveBeenCalledWith(404);
      expect(send).toHaveBeenCalledWith({
        error: 'MCP server is disabled',
        code: MCP_ERROR_CODES.FEATURE_DISABLED,
      });
    });

    it('attaches auth context + policy and emits audit log when auth is valid', async () => {
      authMocks.validateApiKey.mockReturnValue(true);
      const request = makeRequest({ authorization: 'Bearer secret-key-1' });
      (request as unknown as { body: { params: { name: string } } }).body = {
        params: {
          name: 'runs.list_recent',
        },
      };
      const { reply, status } = makeReply();

      await mcpAuthHook(request, reply);

      expect(status).not.toHaveBeenCalled();
      expect(request.mcpAuthContext).toMatchObject({
        actor: 'api-key-1',
        source: 'api_key',
        actorType: 'user',
      });
      expect(request.mcpPolicy).toMatchObject({
        readOnly: true,
      });

      expect(auditMocks.logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
        actorId: 'api-key-1',
        actorType: 'user',
        action: 'mcp.tool_call',
        details: expect.objectContaining({ tool: 'runs.list_recent', source: 'api_key' }),
      }));

      const logInfoSpy = request.server.log.info as ReturnType<typeof vi.fn>;
      expect(logInfoSpy).toHaveBeenCalled();

      const [logObj, logMsg] = logInfoSpy.mock.calls.at(-1) ?? [];
      expect(logMsg).toBe('MCP auth allowed');
      expect(logObj).toMatchObject({
        event: 'mcp.auth',
        actor: 'api-key-1',
        source: 'api_key',
        result: 'allowed',
        tool: 'runs.list_recent',
      });
    });

    it('sets actorType "service" and logs audit event when service account key is used', async () => {
      process.env.DASHBOARD_SERVICE_ACCOUNT_KEY = 'secret-key-1';
      authMocks.validateApiKey.mockReturnValue(true);
      const request = makeRequest({ authorization: 'Bearer secret-key-1' });
      (request as unknown as { body: { params: { name: string } } }).body = {
        params: { name: 'runs.list_recent' },
      };
      const { reply, status } = makeReply();

      await mcpAuthHook(request, reply);

      expect(status).not.toHaveBeenCalled();
      expect(request.mcpAuthContext).toMatchObject({
        actor: 'api-key-1',
        source: 'api_key',
        actorType: 'service',
      });
      expect(request.mcpPolicy).toMatchObject({ readOnly: true });

      expect(auditMocks.logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
        actorId: 'api-key-1',
        actorType: 'service',
        action: 'mcp.tool_call',
      }));
    });
  });
});
