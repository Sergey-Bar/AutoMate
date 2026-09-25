import cookie from '@fastify/cookie';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestApp, type TestApp } from '../../../test/create-test-app.js';
import * as fixtures from '../../../test/fixtures.js';
import * as schema from '../../../db/schema.js';

let testApp: TestApp;

const authServiceMocks = vi.hoisted(() => ({
  SESSION_COOKIE_NAME: 'automate_dashboard_session',
  generateApiKey: vi.fn<(name: string) => { id: string; name: string; key: string; createdAt: string; lastUsedAt: string | null }>(),
  listApiKeys: vi.fn<() => Array<{ id: string; name: string; createdAt: string; lastUsedAt: string | null }>>(),
  loadAuthConfig: vi.fn<
    () => {
      enabled: boolean;
      keys: Array<{ id: string; name: string; key: string; createdAt: string; lastUsedAt: string | null }>;
    }
  >(),
  revokeApiKey: vi.fn<(id: string) => boolean>(),
  saveAuthConfig: vi.fn<(cfg: { enabled: boolean; keys: Array<{ id: string; name: string; key: string; createdAt: string; lastUsedAt: string | null }> }) => void>(),
  validateApiKey: vi.fn<(key: string) => boolean>(),
  generateSessionToken: vi.fn<(keyId: string) => string>(),
  validateSessionToken: vi.fn<(token: string) => boolean>(),
}));

vi.mock('../../../db/client.js', () => ({
  get db() { return testApp.db; },
  get sqlite() { return testApp.sqlite; },
  get poolConnection() {
    return {
      query: async (sql: string, params: any[] = []) => {
        const sqliteSql = sql.replace(/\$(\d+)/g, '?');
        const isSelect = sqliteSql.trim().toUpperCase().startsWith('SELECT');
        const stmt = testApp.sqlite.prepare(sqliteSql);
        if (isSelect) return { rows: stmt.all(params) };
        const info = stmt.run(params);
        return { rows: [], rowCount: info.changes };
      }
    };
  },
  isPostgres: false,
}));

vi.mock('../../../services/auth.js', () => authServiceMocks);

describe('auth integration routes', () => {
  let currentConfig: {
    enabled: boolean;
    keys: Array<{ id: string; name: string; key: string; createdAt: string; lastUsedAt: string | null }>;
  };

  beforeAll(async () => {
    testApp = await createTestApp();
    await testApp.app.register(cookie, { secret: 'test-cookie-secret' });
    const { authRoutes } = await import('../../auth.js');
    await authRoutes(testApp.app);
    await testApp.app.ready();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    currentConfig = {
      enabled: true,
      keys: [
        {
          id: 'k1',
          name: 'primary',
          key: 'valid-api-key',
          createdAt: '2025-01-01T00:00:00.000Z',
          lastUsedAt: null,
        },
      ],
    };

    authServiceMocks.loadAuthConfig.mockImplementation(() => currentConfig);
    authServiceMocks.saveAuthConfig.mockImplementation((cfg) => {
      currentConfig = cfg;
    });
    authServiceMocks.generateSessionToken.mockReturnValue('k1:1700000000000:signature');
    authServiceMocks.validateSessionToken.mockReturnValue(false);
    authServiceMocks.validateApiKey.mockImplementation((key) => currentConfig.keys.some((k) => k.key === key));
    authServiceMocks.listApiKeys.mockImplementation(() =>
      currentConfig.keys.map(({ id, name, createdAt, lastUsedAt }) => ({ id, name, createdAt, lastUsedAt })),
    );
    authServiceMocks.generateApiKey.mockImplementation((name) => ({
      id: 'k2',
      name,
      key: 'new-generated-key',
      createdAt: '2025-01-02T00:00:00.000Z',
      lastUsedAt: null,
    }));
    authServiceMocks.revokeApiKey.mockImplementation((id) => {
      const before = currentConfig.keys.length;
      currentConfig = { ...currentConfig, keys: currentConfig.keys.filter((k) => k.id !== id) };
      return currentConfig.keys.length < before;
    });

    const _useFixtures = fixtures.workspace();
    const _useSchema = schema.runs;
    expect(_useFixtures.id).toBeTruthy();
    expect(_useSchema.id.name).toBe('id');
  });

  afterAll(async () => {
    await testApp.app.close();
    testApp.poolConnection.close();
  });

  it('POST /api/auth/login authenticates valid API key and sets cookie', async () => {
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { apiKey: 'valid-api-key' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ authenticated: true });
    expect(authServiceMocks.generateSessionToken).toHaveBeenCalledWith('k1');
    const setCookie = res.headers['set-cookie'];
    const cookieHeader = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    expect(cookieHeader).toContain('automate_dashboard_session=');
    expect(cookieHeader).toContain('HttpOnly');
  });

  it('POST /api/auth/login rejects invalid API key', async () => {
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { apiKey: 'wrong-key' },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ authenticated: false });
  });

  it('POST /api/auth/login rejects invalid body', async () => {
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { apiKey: '' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBeDefined();
  });

  it('GET /api/auth/status returns unauthenticated without cookie', async () => {
    const res = await testApp.app.inject({ method: 'GET', url: '/api/auth/status' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ enabled: true, authenticated: false, keyCount: 1 });
  });

  it('GET /api/auth/status returns authenticated with valid session cookie', async () => {
    const login = await testApp.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { apiKey: 'valid-api-key' },
    });
    const setCookie = login.headers['set-cookie'];
    const cookieHeader = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    const cookiePair = cookieHeader.split(';')[0];
    authServiceMocks.validateSessionToken.mockReturnValue(true);

    const res = await testApp.app.inject({
      method: 'GET',
      url: '/api/auth/status',
      headers: { cookie: cookiePair },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ enabled: true, authenticated: true, keyCount: 1 });
  });

  it('POST /api/auth/logout clears cookie', async () => {
    const res = await testApp.app.inject({ method: 'POST', url: '/api/auth/logout' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ authenticated: false });
    const setCookie = res.headers['set-cookie'];
    const cookieHeader = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    expect(cookieHeader).toContain('automate_dashboard_session=');
  });

  it('POST /api/auth/keys creates key and GET /api/auth/keys lists it', async () => {
    const createRes = await testApp.app.inject({
      method: 'POST',
      url: '/api/auth/keys',
      payload: { name: 'secondary' },
    });

    expect(createRes.statusCode).toBe(201);
    expect(createRes.json()).toMatchObject({ id: 'k2', name: 'secondary', key: 'new-generated-key' });
    expect(authServiceMocks.saveAuthConfig).toHaveBeenCalledTimes(1);

    const listRes = await testApp.app.inject({ method: 'GET', url: '/api/auth/keys' });
    expect(listRes.statusCode).toBe(200);
    expect(listRes.json()).toEqual([
      { id: 'k1', name: 'primary', createdAt: '2025-01-01T00:00:00.000Z', lastUsedAt: null },
      { id: 'k2', name: 'secondary', createdAt: '2025-01-02T00:00:00.000Z', lastUsedAt: null },
    ]);
  });

  it('DELETE /api/auth/keys/:id removes existing key', async () => {
    const res = await testApp.app.inject({ method: 'DELETE', url: '/api/auth/keys/k1' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it('DELETE /api/auth/keys/:id returns 404 for missing key', async () => {
    const res = await testApp.app.inject({ method: 'DELETE', url: '/api/auth/keys/missing' });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'API key not found' });
  });

  it('PUT /api/auth/enable updates enabled flag visible in status', async () => {
    const putRes = await testApp.app.inject({
      method: 'PUT',
      url: '/api/auth/enable',
      payload: { enabled: false },
    });

    expect(putRes.statusCode).toBe(200);
    expect(putRes.json()).toEqual({ ok: true, enabled: false });

    const statusRes = await testApp.app.inject({ method: 'GET', url: '/api/auth/status' });
    expect(statusRes.statusCode).toBe(200);
    expect(statusRes.json()).toEqual({ enabled: false, authenticated: false, keyCount: 1 });
  });
});
