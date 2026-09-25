/**
 * Tests for plugins/auth.ts — registerAuthPlugin
 *
 * Covers:
 *  - lines 12-14: auth callback registered with @fastify/bearer-auth (validateApiKey)
 *  - line 37: URL passthrough return (health, artifacts, /ws, /api/auth/, /docs, non-/api/)
 *  - line 42: session cookie valid -> return early
 *  - line 45: verifyBearerAuth called for protected /api/* routes
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';

// ── Hoisted mocks ────────────────────────────────────────────────────────────

const {
  mockValidateApiKeyDualRead,
  mockLoadAuthConfig,
  mockValidateSessionTokenAsync,
  mockVerifyBearerAuth,
  SESSION_COOKIE_NAME,
} = vi.hoisted(() => ({
  mockValidateApiKeyDualRead: vi.fn<(key: string) => Promise<boolean>>(),
  mockLoadAuthConfig: vi.fn(),
  mockValidateSessionTokenAsync: vi.fn<(token: string) => Promise<boolean>>(),
  mockVerifyBearerAuth: vi.fn<(req: unknown, reply: unknown, done: (err?: Error) => void) => void>(),
  SESSION_COOKIE_NAME: 'automate_dashboard_session',
}));

vi.mock('../../services/auth.js', () => ({
  loadAuthConfig: mockLoadAuthConfig,
  validateSessionTokenAsync: mockValidateSessionTokenAsync,
  SESSION_COOKIE_NAME,
}));

vi.mock('../../services/api-key-db.js', () => ({
  validateApiKeyDualRead: mockValidateApiKeyDualRead,
}));

// Mock @fastify/bearer-auth: lightweight plugin that decorates the app with
// mockVerifyBearerAuth and captures the auth + errorResponse callbacks.
let capturedAuthCallback: ((key: string) => boolean | Promise<boolean>) | undefined;
let capturedErrorResponse: ((err: Error) => unknown) | undefined;

vi.mock('@fastify/bearer-auth', () => {
  const mockPlugin = async (
    app: FastifyInstance,
    opts: {
      auth?: (key: string) => boolean | Promise<boolean>;
      errorResponse?: (err: Error) => unknown;
    },
  ) => {
    capturedAuthCallback = opts.auth;
    capturedErrorResponse = opts.errorResponse;
    app.decorate('verifyBearerAuth', mockVerifyBearerAuth);
  };
  // Skip Fastify's plugin encapsulation so decorate affects the parent scope
  (mockPlugin as unknown as Record<symbol, boolean>)[Symbol.for('skip-override')] = true;
  return { default: mockPlugin };
});

// ── Helper ───────────────────────────────────────────────────────────────────

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(cookie);

  const { registerAuthPlugin } = await import('../auth.js');
  await registerAuthPlugin(app);

  app.get('/api/runs', async (_req, reply) => reply.send({ ok: true }));
  app.get('/health', async (_req, reply) => reply.send({ ok: true }));
  app.get('/health/live', async (_req, reply) => reply.send({ ok: true }));
  app.get('/artifacts/file.png', async (_req, reply) => reply.send({ ok: true }));
  app.get('/ws', async (_req, reply) => reply.send({ ok: true }));
  app.get('/api/auth/login', async (_req, reply) => reply.send({ ok: true }));
  app.get('/api/auth/saml/status', async (_req, reply) => reply.send({ ok: true }));
  app.get('/docs', async (_req, reply) => reply.send({ ok: true }));
  app.get('/docs/openapi.json', async (_req, reply) => reply.send({ ok: true }));
  app.get('/public', async (_req, reply) => reply.send({ ok: true }));

  await app.ready();
  return app;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('registerAuthPlugin', () => {
  let app: FastifyInstance;

  beforeEach(() => {
    capturedAuthCallback = undefined;
    capturedErrorResponse = undefined;
    vi.clearAllMocks();
    mockVerifyBearerAuth.mockImplementation((_req, _reply, done) => { done(); });
  });

  afterEach(async () => {
    await app?.close();
  });

  describe('when auth is disabled', () => {
    beforeEach(() => {
      mockLoadAuthConfig.mockReturnValue({ enabled: false, keys: [] });
    });

    it('passes all requests through without calling verifyBearerAuth', async () => {
      app = await buildApp();
      const res = await app.inject({ method: 'GET', url: '/api/runs' });
      expect(res.statusCode).toBe(200);
      expect(mockVerifyBearerAuth).not.toHaveBeenCalled();
    });
  });

  describe('when auth is enabled but keys list is empty', () => {
    it('passes all requests through (short-circuit on keys.length === 0)', async () => {
      mockLoadAuthConfig.mockReturnValue({ enabled: true, keys: [] });
      app = await buildApp();
      const res = await app.inject({ method: 'GET', url: '/api/runs' });
      expect(res.statusCode).toBe(200);
      expect(mockVerifyBearerAuth).not.toHaveBeenCalled();
    });
  });

  describe('when auth is enabled with keys', () => {
    beforeEach(() => {
      mockLoadAuthConfig.mockReturnValue({
        enabled: true,
        keys: [{ id: 'key-1', name: 'test', key: 'secret123', createdAt: '', lastUsedAt: null }],
      });
      mockValidateSessionTokenAsync.mockResolvedValue(false);
    });

    describe('URL passthrough (line 37) — bypasses verifyBearerAuth', () => {
      it('passes /health without auth', async () => {
        app = await buildApp();
        const res = await app.inject({ method: 'GET', url: '/health' });
        expect(res.statusCode).toBe(200);
        expect(mockVerifyBearerAuth).not.toHaveBeenCalled();
      });

      it('passes /health/* without auth', async () => {
        app = await buildApp();
        const res = await app.inject({ method: 'GET', url: '/health/live' });
        expect(res.statusCode).toBe(200);
        expect(mockVerifyBearerAuth).not.toHaveBeenCalled();
      });

      it('passes /artifacts/* without auth', async () => {
        app = await buildApp();
        const res = await app.inject({ method: 'GET', url: '/artifacts/file.png' });
        expect(res.statusCode).toBe(200);
        expect(mockVerifyBearerAuth).not.toHaveBeenCalled();
      });

      it('passes exact /ws without auth', async () => {
        app = await buildApp();
        const res = await app.inject({ method: 'GET', url: '/ws' });
        expect(res.statusCode).toBe(200);
        expect(mockVerifyBearerAuth).not.toHaveBeenCalled();
      });

    it('passes /api/auth/saml/* without auth', async () => {
        app = await buildApp();
        const res = await app.inject({ method: 'GET', url: '/api/auth/saml/status' });
        expect(res.statusCode).toBe(200);
        expect(mockVerifyBearerAuth).not.toHaveBeenCalled();
      });

      it('passes /api/auth/* without auth', async () => {
        app = await buildApp();
        const res = await app.inject({ method: 'GET', url: '/api/auth/login' });
        expect(res.statusCode).toBe(200);
        expect(mockVerifyBearerAuth).not.toHaveBeenCalled();
      });

      it('passes /docs without auth', async () => {
        app = await buildApp();
        const res = await app.inject({ method: 'GET', url: '/docs' });
        expect(res.statusCode).toBe(200);
        expect(mockVerifyBearerAuth).not.toHaveBeenCalled();
      });

      it('passes /docs/* without auth', async () => {
        app = await buildApp();
        const res = await app.inject({ method: 'GET', url: '/docs/openapi.json' });
        expect(res.statusCode).toBe(200);
        expect(mockVerifyBearerAuth).not.toHaveBeenCalled();
      });

      it('passes non-/api/* URL without auth', async () => {
        app = await buildApp();
        const res = await app.inject({ method: 'GET', url: '/public' });
        expect(res.statusCode).toBe(200);
        expect(mockVerifyBearerAuth).not.toHaveBeenCalled();
      });
    });

    describe('session cookie (line 42)', () => {
      it('passes when a valid session cookie is present and skips verifyBearerAuth', async () => {
        mockValidateSessionTokenAsync.mockResolvedValue(true);
        app = await buildApp();
        const cookieHeader = SESSION_COOKIE_NAME + '=valid-token';
        const res = await app.inject({
          method: 'GET',
          url: '/api/runs',
          headers: { cookie: cookieHeader },
        });
        expect(res.statusCode).toBe(200);
        expect(mockValidateSessionTokenAsync).toHaveBeenCalledWith('valid-token');
        expect(mockVerifyBearerAuth).not.toHaveBeenCalled();
      });

      it('falls through to verifyBearerAuth when session token is invalid', async () => {
        mockValidateSessionTokenAsync.mockResolvedValue(false);
        app = await buildApp();
        const cookieHeader = SESSION_COOKIE_NAME + '=bad-token';
        await app.inject({
          method: 'GET',
          url: '/api/runs',
          headers: { cookie: cookieHeader },
        });
        expect(mockVerifyBearerAuth).toHaveBeenCalledTimes(1);
      });
    });

    describe('verifyBearerAuth (line 45)', () => {
      it('calls verifyBearerAuth for protected /api/* route with no session cookie', async () => {
        app = await buildApp();
        const res = await app.inject({ method: 'GET', url: '/api/runs' });
        expect(mockVerifyBearerAuth).toHaveBeenCalledTimes(1);
        expect(res.statusCode).toBe(200);
      });

      it('receives request and reply objects in the verifyBearerAuth call', async () => {
        app = await buildApp();
        await app.inject({ method: 'GET', url: '/api/runs' });
        expect(mockVerifyBearerAuth).toHaveBeenCalledTimes(1);
        const callArgs = mockVerifyBearerAuth.mock.calls[0];
        expect(callArgs).toBeDefined();
        expect(callArgs[0]).toBeDefined(); // request
        expect(callArgs[1]).toBeDefined(); // reply
      });
    });

    describe('auth callback registered with @fastify/bearer-auth (lines 12-14)', () => {
      it('registers an auth callback that delegates to validateApiKeyDualRead', async () => {
        app = await buildApp();
        expect(capturedAuthCallback).toBeDefined();
        mockValidateApiKeyDualRead.mockResolvedValue(true);
        const result = await capturedAuthCallback!('test-key');
        expect(mockValidateApiKeyDualRead).toHaveBeenCalledWith('test-key');
        expect(result).toBe(true);
      });

      it('auth callback returns false when validateApiKeyDualRead returns false', async () => {
        app = await buildApp();
        mockValidateApiKeyDualRead.mockResolvedValue(false);
        const result = await capturedAuthCallback!('wrong-key');
        expect(result).toBe(false);
      });
    });

    describe('errorResponse callback registered with @fastify/bearer-auth (line 16)', () => {
      it('registers an errorResponse callback that returns a structured 401 body', async () => {
        app = await buildApp();
        expect(capturedErrorResponse).toBeDefined();
        const err = new Error('Invalid API key');
        const body = capturedErrorResponse!(err);
        expect(body).toEqual({ error: 'Unauthorized', message: 'Invalid API key', statusCode: 401 });
      });

      it('errorResponse includes the error message verbatim', async () => {
        app = await buildApp();
        const err = new Error('Token expired');
        const body = capturedErrorResponse!(err) as Record<string, unknown>;
        expect(body.message).toBe('Token expired');
        expect(body.statusCode).toBe(401);
      });
    });
  });
});
