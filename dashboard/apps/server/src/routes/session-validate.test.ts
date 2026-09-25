import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

// Mock auth service to avoid filesystem access
vi.mock('../services/auth.js', () => ({
  validateSessionToken: vi.fn(),
  loadAuthConfig: vi.fn(),
}));

// Mock feature flags so we can control flag state per-test
vi.mock('../services/feature-flags.js', () => ({
  isEnabled: vi.fn().mockReturnValue(true),
}));

// Dynamic imports AFTER mocks are set up (vi.mock is hoisted)
const { sessionValidateRoutes } = await import('./session-validate.js');
const { validateSessionToken, loadAuthConfig } = await import('../services/auth.js');
const { isEnabled } = await import('../services/feature-flags.js');

const SECRET = 'test-service-secret-xyz';

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await sessionValidateRoutes(app, {});
  await app.ready();
  return app;
}

describe('GET /api/auth/validate-session', () => {
  let app: FastifyInstance;

  beforeEach(() => {
    vi.mocked(isEnabled).mockReturnValue(true);
  });

  afterEach(async () => {
    await app?.close();
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  describe('without AUTOMATE_SERVICE_SECRET configured (fail-closed)', () => {
    beforeEach(async () => {
      vi.stubEnv('AUTOMATE_SERVICE_SECRET', '');
      app = await buildApp();
    });

    it('returns 503 when no service secret is configured', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/auth/validate-session?token=anytoken',
      });

      expect(res.statusCode).toBe(503);
      expect(res.json()).toEqual({ error: 'Service auth not configured' });
    });

    it('still returns 503 even when x-service-secret header is present', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/auth/validate-session?token=anytoken',
        headers: { 'x-service-secret': 'some-value' },
      });

      expect(res.statusCode).toBe(503);
    });
  });

  describe('with AUTOMATE_SERVICE_SECRET configured', () => {
    beforeEach(async () => {
      vi.stubEnv('AUTOMATE_SERVICE_SECRET', SECRET);
      app = await buildApp();
    });

    it('returns 200 with valid=true, userId, username for a valid token', async () => {
      vi.mocked(validateSessionToken).mockReturnValue(true);
      vi.mocked(loadAuthConfig).mockReturnValue({
        keys: [
          {
            id: 'key-uuid-123',
            name: 'Test Key',
            key: 'secretvalue',
            createdAt: '2024-01-01T00:00:00.000Z',
            lastUsedAt: null,
          },
        ],
        enabled: true,
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/auth/validate-session?token=key-uuid-123:1234567890:somesig',
        headers: { 'x-service-secret': SECRET },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        valid: true,
        userId: 'key-uuid-123',
        username: 'Test Key',
      });
    });

    it('uses keyId as username when api key is not found in config', async () => {
      vi.mocked(validateSessionToken).mockReturnValue(true);
      vi.mocked(loadAuthConfig).mockReturnValue({ keys: [], enabled: true });

      const res = await app.inject({
        method: 'GET',
        url: '/api/auth/validate-session?token=orphan-key-id:1234567890:somesig',
        headers: { 'x-service-secret': SECRET },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        valid: true,
        userId: 'orphan-key-id',
        username: 'orphan-key-id',
      });
    });

    it('returns 200 with valid=false for an invalid token', async () => {
      vi.mocked(validateSessionToken).mockReturnValue(false);

      const res = await app.inject({
        method: 'GET',
        url: '/api/auth/validate-session?token=bad-token',
        headers: { 'x-service-secret': SECRET },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ valid: false });
    });

    it('returns 400 when token query param is missing', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/auth/validate-session',
        headers: { 'x-service-secret': SECRET },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: 'token query parameter is required' });
    });

    it('returns 400 when token query param is empty string', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/auth/validate-session?token=',
        headers: { 'x-service-secret': SECRET },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: 'token query parameter is required' });
    });

    it('returns 401 when x-service-secret header is missing', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/auth/validate-session?token=sometoken',
      });

      expect(res.statusCode).toBe(401);
      expect(res.json()).toMatchObject({ error: 'Service authentication required' });
    });

    it('returns 403 when x-service-secret header has wrong token', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/auth/validate-session?token=sometoken',
        headers: { 'x-service-secret': 'wrong-secret' },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({ error: 'Invalid service secret' });
    });

    it('returns 401 when Authorization Bearer has wrong token', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/auth/validate-session?token=sometoken',
        headers: { authorization: 'Bearer wrong-secret' },
      });

      expect(res.statusCode).toBe(403);
    });

    it('returns 404 when unified-auth flag is disabled', async () => {
      vi.mocked(isEnabled).mockReturnValue(false);

      const res = await app.inject({
        method: 'GET',
        url: '/api/auth/validate-session?token=key-uuid-123:1234567890:somesig',
        headers: { 'x-service-secret': SECRET },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({ error: expect.stringContaining('unified-auth') });
    });

    it('returns valid=false for a token with no colon separator (no keyId)', async () => {
      vi.mocked(validateSessionToken).mockReturnValue(true);

      const res = await app.inject({
        method: 'GET',
        url: '/api/auth/validate-session?token=notokenformat',
        headers: { 'x-service-secret': SECRET },
      });

      // validateSessionToken returns true but extractKeyId returns null
      // The route falls through to the keyId check
      expect(res.statusCode).toBe(200);
      // Since token has no colon, extractKeyId returns null → valid=false
      expect(res.json()).toEqual({ valid: false });
    });
  });
});
