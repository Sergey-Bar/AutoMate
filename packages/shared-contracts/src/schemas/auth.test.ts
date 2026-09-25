import {
  PermissionSchema,
  JwtClaimsSchema,
  UnifiedSessionSchema,
  ApiKeySchema,
  ServiceKeySchema,
  TokenValidationSchema,
} from './auth.js';

// ---------------------------------------------------------------------------
// PermissionSchema
// ---------------------------------------------------------------------------

describe('PermissionSchema', () => {
  it('accepts all valid permission values', () => {
    const perms = ['runs:read', 'runs:write', 'tests:read', 'tests:write', 'settings:read', 'settings:write', 'admin'];
    for (const p of perms) {
      expect(PermissionSchema.safeParse(p).success).toBe(true);
    }
  });

  it('rejects an unknown permission', () => {
    expect(PermissionSchema.safeParse('delete:all').success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// JwtClaimsSchema
// ---------------------------------------------------------------------------

describe('JwtClaimsSchema', () => {
  it('accepts a valid full JWT claims object', () => {
    const result = JwtClaimsSchema.safeParse({
      sub: 'user-1',
      iss: 'https://auth.automate.dev',
      aud: 'automate-platform',
      iat: 1700000000,
      exp: 1700003600,
      permissions: ['runs:read', 'tests:read'],
      tenantId: 'tenant-abc',
    });
    expect(result.success).toBe(true);
  });

  it('accepts minimal required fields only', () => {
    const result = JwtClaimsSchema.safeParse({
      sub: 'user-1',
      iss: 'issuer',
      aud: 'audience',
      iat: 1700000000,
      exp: 1700003600,
    });
    expect(result.success).toBe(true);
  });

  it('rejects when sub is missing', () => {
    const result = JwtClaimsSchema.safeParse({
      iss: 'issuer',
      aud: 'audience',
      iat: 1700000000,
      exp: 1700003600,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((i) => i.path[0])).toContain('sub');
    }
  });
});

// ---------------------------------------------------------------------------
// UnifiedSessionSchema
// ---------------------------------------------------------------------------

describe('UnifiedSessionSchema', () => {
  it('accepts a valid session', () => {
    const result = UnifiedSessionSchema.safeParse({
      sessionId: 'sess-abc-123',
      userId: 'user-42',
      tenantId: 'tenant-x',
      permissions: ['runs:read', 'admin'],
      createdAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2026-01-02T00:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });

  it('accepts session without optional tenantId', () => {
    const result = UnifiedSessionSchema.safeParse({
      sessionId: 'sess-1',
      userId: 'user-1',
      permissions: ['tests:read'],
      createdAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2026-01-02T00:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });

  it('rejects when sessionId is missing', () => {
    const result = UnifiedSessionSchema.safeParse({
      userId: 'user-42',
      permissions: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2026-01-02T00:00:00.000Z',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((i) => i.path[0])).toContain('sessionId');
    }
  });
});

// ---------------------------------------------------------------------------
// ApiKeySchema
// ---------------------------------------------------------------------------

describe('ApiKeySchema', () => {
  it('accepts a valid API key', () => {
    const result = ApiKeySchema.safeParse({
      id: 'key-001',
      name: 'CI pipeline key',
      keyHash: 'sha256-abc',
      userId: 'user-42',
      permissions: ['runs:read', 'runs:write'],
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });

  it('rejects when id is missing', () => {
    const result = ApiKeySchema.safeParse({
      name: 'key',
      keyHash: 'hash',
      permissions: [],
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((i) => i.path[0])).toContain('id');
    }
  });
});

// ---------------------------------------------------------------------------
// ServiceKeySchema
// ---------------------------------------------------------------------------

describe('ServiceKeySchema', () => {
  it('accepts a valid service key', () => {
    const result = ServiceKeySchema.safeParse({
      serviceId: 'svc-reporter',
      serviceName: '@automate/reporter',
      keyHash: 'sha256-xyz',
      permissions: ['runs:write'],
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });

  it('rejects when serviceName is missing', () => {
    const result = ServiceKeySchema.safeParse({
      serviceId: 'svc-1',
      keyHash: 'hash',
      permissions: [],
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((i) => i.path[0])).toContain('serviceName');
    }
  });
});

// ---------------------------------------------------------------------------
// TokenValidationSchema
// ---------------------------------------------------------------------------

describe('TokenValidationSchema', () => {
  it('accepts a valid token (valid: true with claims)', () => {
    const result = TokenValidationSchema.safeParse({
      valid: true,
      claims: {
        sub: 'user-1',
        iss: 'issuer',
        aud: 'audience',
        iat: 1700000000,
        exp: 1700003600,
      },
      expiresAt: '2026-06-01T00:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });

  it('accepts an invalid token (valid: false with reason)', () => {
    const result = TokenValidationSchema.safeParse({
      valid: false,
      reason: 'Token expired',
    });
    expect(result.success).toBe(true);
  });

  it('rejects when valid field is missing', () => {
    const result = TokenValidationSchema.safeParse({ reason: 'no token' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((i) => i.path[0])).toContain('valid');
    }
  });
});
