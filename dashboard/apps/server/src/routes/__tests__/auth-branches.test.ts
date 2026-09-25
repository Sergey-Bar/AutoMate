/**
 * Branch coverage for auth routes.
 * Targets:
 *  - POST /api/auth/keys with invalid body → covers `if (!body) return;` (line 81)
 *  - PUT /api/auth/enable with invalid body → covers `if (!body) return;` (line 110)
 */
import cookie from '@fastify/cookie';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTestApp, type TestApp } from '../../test/create-test-app.js';

const authServiceMocks = vi.hoisted(() => ({
  SESSION_COOKIE_NAME: 'automate_dashboard_session',
  generateApiKey: vi.fn(),
  listApiKeys: vi.fn(),
  loadAuthConfig: vi.fn().mockReturnValue({ enabled: true, keys: [] }),
  revokeApiKey: vi.fn(),
  saveAuthConfig: vi.fn(),
  validateApiKey: vi.fn<(key: string) => boolean>().mockReturnValue(false),
  generateSessionToken: vi.fn<(keyId: string) => string>().mockReturnValue('tok'),
  validateSessionToken: vi.fn<(token: string) => boolean>().mockReturnValue(false),
}));

vi.mock('../../services/auth.js', () => authServiceMocks);

describe('auth routes — branch coverage', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp();
    await testApp.app.register(cookie, { secret: 'test-cookie-secret' });
    const { authRoutes } = await import('../auth.js');
    await authRoutes(testApp.app);
    await testApp.app.ready();
  });

  afterAll(async () => {
    await testApp.app.close();
    testApp.poolConnection.close();
  });

  it('POST /api/auth/keys with missing name returns 400 (covers if (!body) return branch)', async () => {
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/auth/keys',
      payload: {}, // Missing required 'name' field
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBeDefined();
  });

  it('PUT /api/auth/enable with invalid body returns 400 (covers if (!body) return branch)', async () => {
    const res = await testApp.app.inject({
      method: 'PUT',
      url: '/api/auth/enable',
      payload: { enabled: 'not-a-boolean' }, // 'enabled' must be boolean, not string
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBeDefined();
  });
});
