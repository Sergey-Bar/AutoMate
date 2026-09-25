/**
 * Tests for plugins/rbac.ts
 *
 * Covers:
 *  - registerRbacPlugin: decorates request with userRole
 *  - onRequest hook: rbac flag OFF → 'admin' for all routes (backward compat)
 *  - onRequest hook: rbac flag ON → URL bypass for /api/auth/, /health, non-/api/
 *  - onRequest hook: rbac flag ON → Bearer key → DB lookup by keyHash → role
 *  - onRequest hook: rbac flag ON → session cookie → DB lookup by keyId → role
 *  - onRequest hook: rbac flag ON → no auth → 'viewer'
 *  - onRequest hook: rbac flag ON → DB returns empty → 'viewer'
 *  - requireRole: rbac OFF → passes regardless
 *  - requireRole: rbac ON → correct role passes, wrong role → 403
 *  - requirePermission: admin → passes for any permission
 *  - requirePermission: editor → passes for allowed, 403 for disallowed
 *  - requirePermission: viewer → passes for 'read', 403 for 'write'
 *  - requirePermission: rbac OFF → passes regardless
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const {
  mockIsEnabled,
  mockHashApiKey,
  mockDbWhere,
  mockDbFrom,
  mockDbSelect,
  SESSION_COOKIE_NAME,
} = vi.hoisted(() => ({
  mockIsEnabled: vi.fn<(flag: string) => boolean>(),
  mockHashApiKey: vi.fn<(key: string) => string>(),
  mockDbWhere: vi.fn(),
  mockDbFrom: vi.fn(),
  mockDbSelect: vi.fn(),
  SESSION_COOKIE_NAME: 'automate_dashboard_session',
}));

vi.mock('../../services/feature-flags.js', () => ({
  isEnabled: mockIsEnabled,
  requireFeature: vi.fn(),
  getFeatureFlags: vi.fn(),
}));

vi.mock('../../services/api-key-db.js', () => ({
  hashApiKey: mockHashApiKey,
  validateApiKeyDualRead: vi.fn(),
  migrateFileKeysToDb: vi.fn(),
}));

vi.mock('../../services/auth.js', () => ({
  SESSION_COOKIE_NAME,
  loadAuthConfig: vi.fn(),
  validateSessionToken: vi.fn(),
  validateApiKey: vi.fn(),
  getCookieSecret: vi.fn().mockReturnValue('test-cookie-secret'),
  generateApiKey: vi.fn(),
  generateSessionToken: vi.fn(),
  listApiKeys: vi.fn(),
  revokeApiKey: vi.fn(),
  saveAuthConfig: vi.fn(),
}));

vi.mock('../../db/client.js', () => ({
  db: { select: mockDbSelect },
  sqlite: { prepare: vi.fn() },
  poolConnection: { query: vi.fn() },
  isPostgres: false,
}));

// ── Helper ────────────────────────────────────────────────────────────────────

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(cookie, { secret: 'test-cookie-secret' });

  const { registerRbacPlugin } = await import('../rbac.js');
  await registerRbacPlugin(app);

  // Route that exposes the resolved userRole in the response body
  app.get('/api/runs', async (req, reply) => reply.send({ ok: true, role: req.userRole }));
  app.get('/api/analytics', async (req, reply) => reply.send({ ok: true, role: req.userRole }));
  app.get('/api/auth/login', async (req, reply) => reply.send({ ok: true, role: req.userRole }));
  app.get('/api/auth/keys', async (req, reply) => reply.send({ ok: true, role: req.userRole }));
  app.get('/health', async (req, reply) => reply.send({ ok: true, role: req.userRole }));
  app.get('/health/live', async (req, reply) => reply.send({ ok: true, role: req.userRole }));
  app.get('/public', async (req, reply) => reply.send({ ok: true, role: req.userRole }));

  await app.ready();
  return app;
}

async function buildAppWithRoleRoute(allowedRoles: ('admin' | 'editor' | 'viewer')[]): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(cookie, { secret: 'test-cookie-secret' });

  const { registerRbacPlugin, requireRole } = await import('../rbac.js');
  await registerRbacPlugin(app);

  app.get('/api/admin-only', {
    preHandler: requireRole(...allowedRoles),
  }, async (req, reply) => reply.send({ ok: true, role: req.userRole }));

  await app.ready();
  return app;
}

async function buildAppWithPermRoute(requiredPerms: string[]): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(cookie, { secret: 'test-cookie-secret' });

  const { registerRbacPlugin, requirePermission } = await import('../rbac.js');
  await registerRbacPlugin(app);

  app.get('/api/guarded', {
    preHandler: requirePermission(...requiredPerms),
  }, async (req, reply) => reply.send({ ok: true, role: req.userRole }));

  await app.ready();
  return app;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('registerRbacPlugin', () => {
  let app: FastifyInstance;

  beforeEach(() => {
    vi.clearAllMocks();
    // Default chain setup — overridden per test as needed
    mockDbSelect.mockReturnValue({ from: mockDbFrom });
    mockDbFrom.mockReturnValue({ where: mockDbWhere });
    mockDbWhere.mockResolvedValue([]);
    mockHashApiKey.mockReturnValue('hashed-key-value');
  });

  afterEach(async () => {
    await app?.close();
  });

  // ── rbac flag OFF ──────────────────────────────────────────────────────────

  describe('rbac flag OFF (default backward compat)', () => {
    beforeEach(() => {
      mockIsEnabled.mockReturnValue(false);
    });

    it('sets userRole to admin for /api/* routes', async () => {
      app = await buildApp();
      const res = await app.inject({ method: 'GET', url: '/api/runs' });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).role).toBe('admin');
    });

    it('sets userRole to admin for /health route', async () => {
      app = await buildApp();
      const res = await app.inject({ method: 'GET', url: '/health' });
      expect(JSON.parse(res.body).role).toBe('admin');
    });

    it('sets userRole to admin for /public route', async () => {
      app = await buildApp();
      const res = await app.inject({ method: 'GET', url: '/public' });
      expect(JSON.parse(res.body).role).toBe('admin');
    });

    it('never queries the DB when rbac is OFF', async () => {
      app = await buildApp();
      await app.inject({ method: 'GET', url: '/api/runs' });
      expect(mockDbSelect).not.toHaveBeenCalled();
    });
  });

  // ── rbac flag ON — URL bypass ──────────────────────────────────────────────

  describe('rbac flag ON — URL bypass', () => {
    beforeEach(() => {
      mockIsEnabled.mockReturnValue(true);
    });

    it('sets userRole to admin for non-/api/ routes (no DB query)', async () => {
      app = await buildApp();
      const res = await app.inject({ method: 'GET', url: '/public' });
      expect(JSON.parse(res.body).role).toBe('admin');
      expect(mockDbSelect).not.toHaveBeenCalled();
    });

    it('sets userRole to admin for /api/auth/* routes (no DB query)', async () => {
      app = await buildApp();
      const res = await app.inject({ method: 'GET', url: '/api/auth/login' });
      expect(JSON.parse(res.body).role).toBe('admin');
      expect(mockDbSelect).not.toHaveBeenCalled();
    });

    it('sets userRole to admin for /api/auth/keys (no DB query)', async () => {
      app = await buildApp();
      const res = await app.inject({ method: 'GET', url: '/api/auth/keys' });
      expect(JSON.parse(res.body).role).toBe('admin');
      expect(mockDbSelect).not.toHaveBeenCalled();
    });

    it('sets userRole to admin for /health (no DB query)', async () => {
      app = await buildApp();
      const res = await app.inject({ method: 'GET', url: '/health' });
      expect(JSON.parse(res.body).role).toBe('admin');
      expect(mockDbSelect).not.toHaveBeenCalled();
    });

    it('sets userRole to admin for /health/* (no DB query)', async () => {
      app = await buildApp();
      const res = await app.inject({ method: 'GET', url: '/health/live' });
      expect(JSON.parse(res.body).role).toBe('admin');
      expect(mockDbSelect).not.toHaveBeenCalled();
    });
  });

  // ── rbac flag ON — role resolution ────────────────────────────────────────

  describe('rbac flag ON — role resolution from Bearer key', () => {
    beforeEach(() => {
      mockIsEnabled.mockReturnValue(true);
      mockHashApiKey.mockReturnValue('sha256-of-test-key');
    });

    it('resolves role from DB using Bearer key hash', async () => {
      mockDbWhere.mockResolvedValue([{ role: 'editor' }]);
      app = await buildApp();
      const res = await app.inject({
        method: 'GET',
        url: '/api/runs',
        headers: { authorization: 'Bearer my-test-api-key' },
      });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).role).toBe('editor');
      expect(mockHashApiKey).toHaveBeenCalledWith('my-test-api-key');
      expect(mockDbSelect).toHaveBeenCalledTimes(1);
    });

    it('resolves to viewer when DB returns no rows for Bearer key', async () => {
      mockDbWhere.mockResolvedValue([]);
      app = await buildApp();
      const res = await app.inject({
        method: 'GET',
        url: '/api/runs',
        headers: { authorization: 'Bearer unknown-key' },
      });
      expect(JSON.parse(res.body).role).toBe('viewer');
    });

    it('resolves admin role from Bearer key', async () => {
      mockDbWhere.mockResolvedValue([{ role: 'admin' }]);
      app = await buildApp();
      const res = await app.inject({
        method: 'GET',
        url: '/api/analytics',
        headers: { authorization: 'Bearer admin-key' },
      });
      expect(JSON.parse(res.body).role).toBe('admin');
    });
  });

  describe('rbac flag ON — role resolution from session cookie', () => {
    beforeEach(() => {
      mockIsEnabled.mockReturnValue(true);
    });

    it('resolves role from DB using keyId extracted from session cookie', async () => {
      mockDbWhere.mockResolvedValue([{ role: 'viewer' }]);
      // Session token format: keyId:timestamp:signature
      const cookieValue = `${SESSION_COOKIE_NAME}=some-key-uuid:1700000000000:deadbeef`;
      app = await buildApp();
      const res = await app.inject({
        method: 'GET',
        url: '/api/runs',
        headers: { cookie: cookieValue },
      });
      expect(JSON.parse(res.body).role).toBe('viewer');
      expect(mockDbSelect).toHaveBeenCalledTimes(1);
    });

    it('resolves editor role from session cookie', async () => {
      mockDbWhere.mockResolvedValue([{ role: 'editor' }]);
      const cookieValue = `${SESSION_COOKIE_NAME}=editor-key-uuid:1700000000000:abc123`;
      app = await buildApp();
      const res = await app.inject({
        method: 'GET',
        url: '/api/analytics',
        headers: { cookie: cookieValue },
      });
      expect(JSON.parse(res.body).role).toBe('editor');
    });

    it('falls back to viewer when DB returns empty for session keyId', async () => {
      mockDbWhere.mockResolvedValue([]);
      const cookieValue = `${SESSION_COOKIE_NAME}=nonexistent-key:1700000000000:sig`;
      app = await buildApp();
      const res = await app.inject({
        method: 'GET',
        url: '/api/runs',
        headers: { cookie: cookieValue },
      });
      expect(JSON.parse(res.body).role).toBe('viewer');
    });
  });

  describe('rbac flag ON — no auth header or cookie', () => {
    beforeEach(() => {
      mockIsEnabled.mockReturnValue(true);
    });

    it('defaults to viewer when no Bearer header and no session cookie', async () => {
      app = await buildApp();
      const res = await app.inject({ method: 'GET', url: '/api/runs' });
      expect(JSON.parse(res.body).role).toBe('viewer');
      expect(mockDbSelect).not.toHaveBeenCalled();
    });
  });
});

// ── requireRole ───────────────────────────────────────────────────────────────

describe('requireRole', () => {
  let app: FastifyInstance;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDbSelect.mockReturnValue({ from: mockDbFrom });
    mockDbFrom.mockReturnValue({ where: mockDbWhere });
    mockDbWhere.mockResolvedValue([]);
  });

  afterEach(async () => {
    await app?.close();
  });

  describe('rbac flag OFF', () => {
    beforeEach(() => {
      mockIsEnabled.mockReturnValue(false);
    });

    it('passes when caller has no matching role (flag is OFF)', async () => {
      app = await buildAppWithRoleRoute(['admin']);
      // With rbac OFF, onRequest sets role to 'admin' — and requireRole no-ops
      const res = await app.inject({ method: 'GET', url: '/api/admin-only' });
      expect(res.statusCode).toBe(200);
    });
  });

  describe('rbac flag ON', () => {
    it('passes when caller role is in the allowed list', async () => {
      // rbac ON: isEnabled returns true for both onRequest and requireRole calls
      mockIsEnabled.mockReturnValue(true);
      mockDbWhere.mockResolvedValue([{ role: 'admin' }]);
      mockHashApiKey.mockReturnValue('admin-hash');

      app = await buildAppWithRoleRoute(['admin', 'editor']);
      const res = await app.inject({
        method: 'GET',
        url: '/api/admin-only',
        headers: { authorization: 'Bearer admin-key' },
      });
      expect(res.statusCode).toBe(200);
    });

    it('returns 403 when caller role is not in the allowed list', async () => {
      mockIsEnabled.mockReturnValue(true);
      mockDbWhere.mockResolvedValue([{ role: 'viewer' }]);
      mockHashApiKey.mockReturnValue('viewer-hash');

      app = await buildAppWithRoleRoute(['admin']);
      const res = await app.inject({
        method: 'GET',
        url: '/api/admin-only',
        headers: { authorization: 'Bearer viewer-key' },
      });
      expect(res.statusCode).toBe(403);
      const body = JSON.parse(res.body) as { error: string; message: string };
      expect(body.error).toBe('Forbidden');
      expect(body.message).toContain('viewer');
    });

    it('returns 403 with message describing required role', async () => {
      mockIsEnabled.mockReturnValue(true);
      mockDbWhere.mockResolvedValue([{ role: 'editor' }]);
      mockHashApiKey.mockReturnValue('editor-hash');

      app = await buildAppWithRoleRoute(['admin']);
      const res = await app.inject({
        method: 'GET',
        url: '/api/admin-only',
        headers: { authorization: 'Bearer editor-key' },
      });
      expect(res.statusCode).toBe(403);
      const body = JSON.parse(res.body) as { message: string };
      expect(body.message).toContain("Role 'editor'");
    });

    it('passes when caller role is editor and editor is in allowed list', async () => {
      mockIsEnabled.mockReturnValue(true);
      mockDbWhere.mockResolvedValue([{ role: 'editor' }]);
      mockHashApiKey.mockReturnValue('editor-hash');

      app = await buildAppWithRoleRoute(['editor', 'admin']);
      const res = await app.inject({
        method: 'GET',
        url: '/api/admin-only',
        headers: { authorization: 'Bearer editor-key' },
      });
      expect(res.statusCode).toBe(200);
    });
  });
});

// ── requirePermission ─────────────────────────────────────────────────────────

describe('requirePermission', () => {
  let app: FastifyInstance;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDbSelect.mockReturnValue({ from: mockDbFrom });
    mockDbFrom.mockReturnValue({ where: mockDbWhere });
    mockDbWhere.mockResolvedValue([]);
    mockHashApiKey.mockReturnValue('hashed-key');
  });

  afterEach(async () => {
    await app?.close();
  });

  describe('rbac flag OFF', () => {
    it('passes for any permission when rbac is OFF', async () => {
      mockIsEnabled.mockReturnValue(false);
      app = await buildAppWithPermRoute(['admin-only-action']);
      const res = await app.inject({ method: 'GET', url: '/api/guarded' });
      expect(res.statusCode).toBe(200);
    });
  });

  describe('admin role — has wildcard permission', () => {
    beforeEach(() => {
      mockIsEnabled.mockReturnValue(true);
      mockDbWhere.mockResolvedValue([{ role: 'admin' }]);
    });

    it('passes for any single permission', async () => {
      app = await buildAppWithPermRoute(['admin-only-action']);
      const res = await app.inject({
        method: 'GET',
        url: '/api/guarded',
        headers: { authorization: 'Bearer admin-key' },
      });
      expect(res.statusCode).toBe(200);
    });

    it('passes for multiple permissions simultaneously', async () => {
      app = await buildAppWithPermRoute(['read', 'write', 'gate.edit']);
      const res = await app.inject({
        method: 'GET',
        url: '/api/guarded',
        headers: { authorization: 'Bearer admin-key' },
      });
      expect(res.statusCode).toBe(200);
    });
  });

  describe('editor role', () => {
    beforeEach(() => {
      mockIsEnabled.mockReturnValue(true);
      mockDbWhere.mockResolvedValue([{ role: 'editor' }]);
    });

    it('passes for "write" permission', async () => {
      app = await buildAppWithPermRoute(['write']);
      const res = await app.inject({
        method: 'GET',
        url: '/api/guarded',
        headers: { authorization: 'Bearer editor-key' },
      });
      expect(res.statusCode).toBe(200);
    });

    it('passes for "read" permission', async () => {
      app = await buildAppWithPermRoute(['read']);
      const res = await app.inject({
        method: 'GET',
        url: '/api/guarded',
        headers: { authorization: 'Bearer editor-key' },
      });
      expect(res.statusCode).toBe(200);
    });

    it('passes for "quarantine.edit" permission', async () => {
      app = await buildAppWithPermRoute(['quarantine.edit']);
      const res = await app.inject({
        method: 'GET',
        url: '/api/guarded',
        headers: { authorization: 'Bearer editor-key' },
      });
      expect(res.statusCode).toBe(200);
    });

    it('returns 403 for a permission not in editor set', async () => {
      app = await buildAppWithPermRoute(['admin-only-action']);
      const res = await app.inject({
        method: 'GET',
        url: '/api/guarded',
        headers: { authorization: 'Bearer editor-key' },
      });
      expect(res.statusCode).toBe(403);
      const body = JSON.parse(res.body) as { error: string; message: string };
      expect(body.error).toBe('Forbidden');
      expect(body.message).toContain('admin-only-action');
    });
  });

  describe('viewer role', () => {
    beforeEach(() => {
      mockIsEnabled.mockReturnValue(true);
      mockDbWhere.mockResolvedValue([{ role: 'viewer' }]);
    });

    it('passes for "read" permission', async () => {
      app = await buildAppWithPermRoute(['read']);
      const res = await app.inject({
        method: 'GET',
        url: '/api/guarded',
        headers: { authorization: 'Bearer viewer-key' },
      });
      expect(res.statusCode).toBe(200);
    });

    it('returns 403 for "write" permission', async () => {
      app = await buildAppWithPermRoute(['write']);
      const res = await app.inject({
        method: 'GET',
        url: '/api/guarded',
        headers: { authorization: 'Bearer viewer-key' },
      });
      expect(res.statusCode).toBe(403);
    });

    it('returns 403 for "gate.edit" permission', async () => {
      app = await buildAppWithPermRoute(['gate.edit']);
      const res = await app.inject({
        method: 'GET',
        url: '/api/guarded',
        headers: { authorization: 'Bearer viewer-key' },
      });
      expect(res.statusCode).toBe(403);
      const body = JSON.parse(res.body) as { message: string };
      expect(body.message).toContain('gate.edit');
    });
  });
});
