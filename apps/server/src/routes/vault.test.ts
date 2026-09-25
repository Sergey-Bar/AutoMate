import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { vaultRoutes, _resetUnlockRateLimit } from './vault.js';
import type { VaultRouteDeps } from './vault.js';

function createMocks() {
  return {
    mockUnlock: vi.fn().mockResolvedValue(undefined),
    mockLock: vi.fn(),
    mockSetCredential: vi.fn().mockResolvedValue(undefined),
    mockGetCredential: vi.fn().mockResolvedValue(null),
    mockIsUnlocked: vi.fn().mockReturnValue(false),
  };
}

function buildDeps(
  mocks: ReturnType<typeof createMocks>,
  expectedPassword?: string,
): VaultRouteDeps {
  return {
    vaultService: {
      unlock: mocks.mockUnlock as VaultRouteDeps['vaultService']['unlock'],
      lock: mocks.mockLock as VaultRouteDeps['vaultService']['lock'],
      isUnlocked: mocks.mockIsUnlocked as VaultRouteDeps['vaultService']['isUnlocked'],
      setCredential: mocks.mockSetCredential as VaultRouteDeps['vaultService']['setCredential'],
      getCredential: mocks.mockGetCredential as VaultRouteDeps['vaultService']['getCredential'],
    },
    expectedPassword,
  };
}

async function buildApp(deps: VaultRouteDeps): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register((instance: FastifyInstance, _opts: unknown, done: (err?: Error) => void) => {
    vaultRoutes(instance, deps).then(() => done()).catch(done);
  });
  await app.ready();
  return app;
}

describe('vault routes', () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(() => {
    _resetUnlockRateLimit();
  });

  afterEach(async () => {
    await app?.close();
  });

  describe('with expectedPassword configured', () => {
    let mocks: ReturnType<typeof createMocks>;

    beforeEach(async () => {
      mocks = createMocks();
      app = await buildApp(buildDeps(mocks, 'test-password'));
    });

    it('GET /api/vault/status returns locked initially', async () => {
      const response = await app.inject({ method: 'GET', url: '/api/vault/status' });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ isUnlocked: false });
    });

    it('POST /api/vault/unlock with valid password succeeds', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/vault/unlock',
        payload: { password: 'test-password' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ ok: true });
      expect(mocks.mockUnlock).toHaveBeenCalledTimes(1);
      expect(mocks.mockUnlock).toHaveBeenCalledWith('test-password');
    });

    it('POST /api/vault/unlock with wrong password returns 401', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/vault/unlock',
        payload: { password: 'wrong-password' },
      });

      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ error: 'Unlock failed' });
      expect(mocks.mockUnlock).not.toHaveBeenCalled();
    });

    it('POST /api/vault/unlock with no password returns 400', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/vault/unlock',
        payload: {},
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error).toContain('password');
      expect(mocks.mockUnlock).toHaveBeenCalledTimes(0);
    });

    it('POST /api/vault/unlock returns 500 when service throws', async () => {
      mocks.mockUnlock.mockRejectedValueOnce(new Error('Unlock failed hard'));

      const response = await app.inject({
        method: 'POST',
        url: '/api/vault/unlock',
        payload: { password: 'test-password' },
      });

      expect(response.statusCode).toBe(500);
      expect(response.json()).toEqual({ error: 'Unlock failed' });
      expect(mocks.mockUnlock).toHaveBeenCalledTimes(1);
      expect(mocks.mockUnlock).toHaveBeenCalledWith('test-password');
    });

    it('POST /api/vault/unlock returns generic error for non-Error throws', async () => {
      mocks.mockUnlock.mockRejectedValueOnce('raw string error');

      const response = await app.inject({
        method: 'POST',
        url: '/api/vault/unlock',
        payload: { password: 'test-password' },
      });

      expect(response.statusCode).toBe(500);
      expect(response.json()).toEqual({ error: 'Unlock failed' });
      expect(mocks.mockUnlock).toHaveBeenCalledTimes(1);
      expect(mocks.mockUnlock).toHaveBeenCalledWith('test-password');
    });

    it('POST /api/vault/lock succeeds', async () => {
      const response = await app.inject({ method: 'POST', url: '/api/vault/lock' });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ ok: true });
      expect(mocks.mockLock).toHaveBeenCalledTimes(1);
    });

    it('GET /api/vault/status after unlock returns unlocked', async () => {
      const unlockResponse = await app.inject({
        method: 'POST',
        url: '/api/vault/unlock',
        payload: { password: 'test-password' },
      });
      // After unlock, the service reports unlocked
      mocks.mockIsUnlocked.mockReturnValue(true);
      const statusResponse = await app.inject({ method: 'GET', url: '/api/vault/status' });

      expect(unlockResponse.statusCode).toBe(200);
      expect(unlockResponse.json()).toEqual({ ok: true });
      expect(statusResponse.statusCode).toBe(200);
      expect(statusResponse.json()).toEqual({ isUnlocked: true });
    });

    it('GET /api/vault/status after lock returns locked', async () => {
      const unlockResponse = await app.inject({
        method: 'POST',
        url: '/api/vault/unlock',
        payload: { password: 'test-password' },
      });
      mocks.mockIsUnlocked.mockReturnValue(true);
      const lockResponse = await app.inject({ method: 'POST', url: '/api/vault/lock' });
      // After lock, the service reports locked
      mocks.mockIsUnlocked.mockReturnValue(false);
      const statusResponse = await app.inject({ method: 'GET', url: '/api/vault/status' });

      expect(unlockResponse.statusCode).toBe(200);
      expect(lockResponse.statusCode).toBe(200);
      expect(statusResponse.statusCode).toBe(200);
      expect(statusResponse.json()).toEqual({ isUnlocked: false });
      expect(mocks.mockLock).toHaveBeenCalledTimes(1);
    });

    it('PUT /api/vault/credentials/:connector succeeds when unlocked', async () => {
      // Service reports unlocked
      mocks.mockIsUnlocked.mockReturnValue(true);
      const credentials = { apiKey: 'abc123', region: 'eu-west-1' };
      const response = await app.inject({
        method: 'PUT',
        url: '/api/vault/credentials/slack',
        payload: { credentials },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ ok: true });
      expect(mocks.mockSetCredential).toHaveBeenCalledTimes(1);
      expect(mocks.mockSetCredential).toHaveBeenCalledWith('slack', JSON.stringify(credentials));
    });

    it('PUT /api/vault/credentials/:connector returns 403 when locked', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: '/api/vault/credentials/slack',
        payload: { credentials: { apiKey: 'abc123' } },
      });

      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({ error: 'Vault is locked' });
      expect(mocks.mockSetCredential).toHaveBeenCalledTimes(0);
    });

    it('PUT /api/vault/credentials/:connector with missing credentials returns 400', async () => {
      mocks.mockIsUnlocked.mockReturnValue(true);
      const response = await app.inject({
        method: 'PUT',
        url: '/api/vault/credentials/slack',
        payload: {},
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error).toContain('credentials');
      expect(mocks.mockSetCredential).toHaveBeenCalledTimes(0);
    });

    it('PUT /api/vault/credentials/:connector with non-object credentials returns 400', async () => {
      mocks.mockIsUnlocked.mockReturnValue(true);
      const response = await app.inject({
        method: 'PUT',
        url: '/api/vault/credentials/slack',
        payload: { credentials: 'not-an-object' },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error).toContain('credentials');
      expect(mocks.mockSetCredential).toHaveBeenCalledTimes(0);
    });
  });

  describe('rate limiting', () => {
    let mocks: ReturnType<typeof createMocks>;

    beforeEach(async () => {
      mocks = createMocks();
      app = await buildApp(buildDeps(mocks, 'test-password'));
      _resetUnlockRateLimit();
    });

    // Mutation kill: 429 error message 'Too many unlock attempts. Try again later.' → ""
    it('POST /api/vault/unlock returns exact 429 error message when rate limited', async () => {
      // Exhaust the rate limit (5 attempts)
      for (let i = 0; i < 5; i++) {
        await app.inject({
          method: 'POST',
          url: '/api/vault/unlock',
          payload: { password: 'wrong' },
        });
      }

      const response = await app.inject({
        method: 'POST',
        url: '/api/vault/unlock',
        payload: { password: 'test-password' },
      });

      expect(response.statusCode).toBe(429);
      expect(response.json()).toEqual({
        error: 'Too many unlock attempts. Try again later.',
      });
    });

    // Mutation kill: body null check — if (!body) return; → if (false) return;
    // Without the guard, invalid body would fall through and cause a crash instead of 400
    it('PUT /api/vault/credentials/:connector with completely empty body returns 400, not crash', async () => {
      mocks.mockIsUnlocked.mockReturnValue(true);

      const response = await app.inject({
        method: 'PUT',
        url: '/api/vault/credentials/github',
        headers: { 'content-type': 'application/json' },
        payload: null,
      });

      // Should be 400 from validateOrReply guard, not 500
      expect(response.statusCode).toBe(400);
      expect(mocks.mockSetCredential).not.toHaveBeenCalled();
    });
  });

  describe('without expectedPassword configured', () => {
    let mocks: ReturnType<typeof createMocks>;

    beforeEach(async () => {
      mocks = createMocks();
      app = await buildApp(buildDeps(mocks));
    });

    it('POST /api/vault/unlock returns 403 when VAULT_PASSWORD is not set', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/vault/unlock',
        payload: { password: 'any-password' },
      });

      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({
        error: 'Vault password not configured. Set the VAULT_PASSWORD environment variable.',
      });
      expect(mocks.mockUnlock).not.toHaveBeenCalled();
    });

    it('vault status and lock still work without expectedPassword', async () => {
      const statusRes = await app.inject({ method: 'GET', url: '/api/vault/status' });
      expect(statusRes.statusCode).toBe(200);

      const lockRes = await app.inject({ method: 'POST', url: '/api/vault/lock' });
      expect(lockRes.statusCode).toBe(200);
    });
  });
});
