import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import { authRoutes } from '../auth.js';
import * as authService from '../../services/auth.js';
import * as apiKeyDbService from '../../services/api-key-db.js';
import * as featureFlags from '../../services/feature-flags.js';
import * as auditService from '../../services/audit.js';

vi.mock('../../services/auth.js');
vi.mock('../../services/api-key-db.js');
vi.mock('../../services/feature-flags.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/feature-flags.js')>();
  return {
    ...actual,
    requireFeature: vi.fn(),
    isEnabled: vi.fn(),
  };
});
vi.mock('../../services/audit.js');
// rbac.ts imports db/client.js directly — mock the whole plugin to avoid SQLite init
vi.mock('../../plugins/rbac.js', () => ({
  registerRbacPlugin: vi.fn(),
  requireRole: vi.fn(() => async () => {}),
  requirePermission: vi.fn(() => async () => {}),
  invalidatePermissionCache: vi.fn(),
}));
// Prevent db/client.js from opening a real SQLite file in tests
vi.mock('../../db/client.js', () => ({
  db: {},
  poolConnection: { close: vi.fn() },
}));
vi.mock('../../db/schema.js', () => ({ apiKeys: {} }));

describe('POST /api/auth/bootstrap', () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    vi.resetAllMocks();
    
    app = Fastify();
    
    // Mock the preHandler
    vi.mocked(featureFlags.requireFeature).mockReturnValue(async () => {});
    
    await app.register(authRoutes);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('should return 409 if keys already exist', async () => {
    vi.mocked(authService.loadAuthConfig).mockReturnValue({
      enabled: true,
      keys: [{ id: '1', name: 'admin', key: 'key-1', createdAt: new Date().toISOString() }]
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/bootstrap'
    });

    expect(response.statusCode).toBe(409);
    expect(JSON.parse(response.payload)).toEqual({ error: 'System already initialized' });
  });

  it('should generate key and return 201 if no keys exist', async () => {
    vi.mocked(authService.loadAuthConfig).mockReturnValue({
      enabled: true,
      keys: []
    });
    vi.mocked(apiKeyDbService.createApiKeyInDb).mockResolvedValue({
      id: 'new-id',
      name: 'bootstrap',
      key: 'generated-key-123',
      createdAt: '2026-05-04T00:00:00.000Z',
      lastUsedAt: null,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/bootstrap'
    });

    expect(response.statusCode).toBe(201);
    expect(JSON.parse(response.payload)).toEqual({ apiKey: 'generated-key-123' });
    expect(apiKeyDbService.createApiKeyInDb).toHaveBeenCalledWith('bootstrap');
    expect(authService.saveAuthConfig).not.toHaveBeenCalled();
    expect(auditService.logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'key.create',
      details: { name: 'bootstrap' }
    }));
  });
});
