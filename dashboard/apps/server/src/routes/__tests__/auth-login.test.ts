import cookie from '@fastify/cookie';
import Fastify from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestApp, type TestApp } from '../../test/create-test-app.js';

const authServiceMocks = vi.hoisted(() => ({
  SESSION_COOKIE_NAME: 'automate_dashboard_session',
  generateApiKey: vi.fn(),
  listApiKeys: vi.fn(),
  loadAuthConfig: vi.fn(),
  revokeApiKey: vi.fn(),
  saveAuthConfig: vi.fn(),
  validateApiKey: vi.fn<(key: string) => boolean>(),
  generateSessionToken: vi.fn<(keyId: string) => string>(),
  validateSessionToken: vi.fn<(token: string) => boolean>(),
  validateSessionTokenAsync: vi.fn<(token: string) => Promise<boolean>>(),
}));

vi.mock('../../services/auth.js', () => authServiceMocks);

describe('auth routes session endpoints', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp();
    await testApp.app.register(cookie, { secret: 'test-cookie-secret' });
    const { authRoutes } = await import('../auth.js');
    await authRoutes(testApp.app);
    await testApp.app.ready();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    authServiceMocks.loadAuthConfig.mockReturnValue({
      enabled: true,
      keys: [
        {
          id: 'k1',
          name: 'primary',
          key: 'valid-api-key',
          createdAt: '2024-01-01T00:00:00.000Z',
          lastUsedAt: null,
        },
      ],
    });
    authServiceMocks.generateSessionToken.mockReturnValue('k1:1700000000000:signature');
  });

  afterAll(async () => {
    await testApp.app.close();
    testApp.poolConnection.close();
  });

  it('POST /api/auth/login validates API key and sets httpOnly session cookie', async () => {
    authServiceMocks.validateApiKey.mockReturnValue(true);

    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { apiKey: 'valid-api-key' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ authenticated: true });
    expect(authServiceMocks.validateApiKey).toHaveBeenCalledWith('valid-api-key');

    const setCookie = res.headers['set-cookie'];
    expect(setCookie).toBeDefined();
    const cookieHeader = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    expect(cookieHeader).toContain('automate_dashboard_session=');
    expect(cookieHeader).toContain('HttpOnly');
    expect(cookieHeader).toContain('Path=/');
    expect(cookieHeader).toContain('SameSite=Lax');
    expect(cookieHeader).toContain('Max-Age=604800');
  });

  it('POST /api/auth/login rejects invalid API key', async () => {
    authServiceMocks.validateApiKey.mockReturnValue(false);

    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { apiKey: 'invalid-api-key' },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ authenticated: false });
  });

  it('POST /api/auth/logout clears session cookie', async () => {
    const res = await testApp.app.inject({ method: 'POST', url: '/api/auth/logout' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ authenticated: false });

    const setCookie = res.headers['set-cookie'];
    const cookieHeader = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    expect(cookieHeader).toContain('automate_dashboard_session=');
    expect(cookieHeader).toMatch(/Max-Age=0|Expires=/);
  });

  it('POST /api/auth/login returns 401 when validateApiKey passes but key not found in config', async () => {
    // validateApiKey passes timing-safe check, but the key is not in config.keys
    authServiceMocks.validateApiKey.mockReturnValue(true);
    authServiceMocks.loadAuthConfig.mockReturnValue({
      enabled: true,
      keys: [], // empty — key won't be found
    });

    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { apiKey: 'valid-api-key' },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ authenticated: false });
  });

  it('PUT /api/auth/enable returns 400 when trying to enable auth with no API keys', async () => {
    authServiceMocks.loadAuthConfig.mockReturnValue({
      enabled: false,
      keys: [],
    });

    const res = await testApp.app.inject({
      method: 'PUT',
      url: '/api/auth/enable',
      payload: { enabled: true },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('Cannot enable authentication without any API keys');
  });

  it('GET /api/auth/status includes authenticated true when session cookie is valid', async () => {
    authServiceMocks.validateApiKey.mockReturnValue(true);
    const loginRes = await testApp.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { apiKey: 'valid-api-key' },
    });

    const setCookie = loginRes.headers['set-cookie'];
    const cookieHeader = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    const cookiePair = cookieHeader.split(';')[0];

    authServiceMocks.validateSessionToken.mockReturnValue(true);
    const res = await testApp.app.inject({
      method: 'GET',
      url: '/api/auth/status',
      headers: {
        cookie: cookiePair,
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ enabled: true, authenticated: true, keyCount: 1 });
  });
});

describe('POST /api/auth/login rate limit config', () => {
  it('has stricter rate limit config: 10 requests per 15 minutes', async () => {
    const app = Fastify();
    let loginRouteConfig: unknown;

    app.addHook('onRoute', (routeOptions) => {
      const method = Array.isArray(routeOptions.method)
        ? routeOptions.method
        : [routeOptions.method];

      if (routeOptions.url === '/api/auth/login' && method.includes('POST')) {
        loginRouteConfig = routeOptions.config;
      }
    });

    await app.register(async (instance) => {
      const { authRoutes } = await import('../auth.js');
      await authRoutes(instance);
    });

    expect(loginRouteConfig).toEqual({
      rateLimit: { max: 10, timeWindow: '15 minutes' },
    });

    await app.close();
  });

  it('other auth routes do not have a per-route rate limit config', async () => {
    const app = Fastify();
    const routeConfigs: Record<string, unknown> = {};

    app.addHook('onRoute', (routeOptions) => {
      const method = Array.isArray(routeOptions.method)
        ? routeOptions.method[0]
        : routeOptions.method;
      const key = `${method} ${routeOptions.url}`;
      routeConfigs[key] = routeOptions.config;
    });

    await app.register(async (instance) => {
      const { authRoutes } = await import('../auth.js');
      await authRoutes(instance);
    });

    // Only login has the stricter rate limit
    expect(routeConfigs['POST /api/auth/login']).toEqual({
      rateLimit: { max: 10, timeWindow: '15 minutes' },
    });
    // Other routes should not have a rateLimit override (config is undefined or lacks rateLimit)
    const logoutConfig = routeConfigs['POST /api/auth/logout'];
    const keysPostConfig = routeConfigs['POST /api/auth/keys'];
    const keysGetConfig = routeConfigs['GET /api/auth/keys'];
    expect(logoutConfig == null || !('rateLimit' in (logoutConfig as object))).toBe(true);
    expect(keysPostConfig == null || !('rateLimit' in (keysPostConfig as object))).toBe(true);
    expect(keysGetConfig == null || !('rateLimit' in (keysGetConfig as object))).toBe(true);

    await app.close();
  });
});

describe('auth plugin session cookie behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authServiceMocks.loadAuthConfig.mockReturnValue({
      enabled: true,
      keys: [
        {
          id: 'k1',
          name: 'primary',
          key: 'valid-api-key',
          createdAt: '2024-01-01T00:00:00.000Z',
          lastUsedAt: null,
        },
      ],
    });
  });

  it('allows /api requests with valid session cookie without bearer token', async () => {
    const app = Fastify();
    await app.register(cookie, { secret: 'test-cookie-secret' });
    const { registerAuthPlugin } = await import('../../plugins/auth.js');
    await registerAuthPlugin(app);
    app.get('/api/protected', async () => ({ ok: true }));
    await app.ready();

    authServiceMocks.validateSessionTokenAsync.mockResolvedValue(true);
    const res = await app.inject({
      method: 'GET',
      url: '/api/protected',
      headers: {
        cookie: 'automate_dashboard_session=valid-session-token',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(authServiceMocks.validateApiKey).not.toHaveBeenCalled();

    await app.close();
  });
});
