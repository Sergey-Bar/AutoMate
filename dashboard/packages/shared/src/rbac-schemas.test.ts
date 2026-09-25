import { describe, it, expect } from 'vitest';
import {
  UserRoleSchema,
  UserSchema,
  RoleSchema,
  ApiKeySchema,
} from './index.js';

describe('UserRoleSchema', () => {
  it('accepts valid roles', () => {
    expect(UserRoleSchema.parse('admin')).toBe('admin');
    expect(UserRoleSchema.parse('editor')).toBe('editor');
    expect(UserRoleSchema.parse('viewer')).toBe('viewer');
  });

  it('rejects invalid role strings', () => {
    expect(() => UserRoleSchema.parse('superuser')).toThrow();
    expect(() => UserRoleSchema.parse('')).toThrow();
    expect(() => UserRoleSchema.parse(null)).toThrow();
  });
});

describe('UserSchema', () => {
  const validUser = {
    id: 'u-1',
    email: 'alice@example.com',
    displayName: 'Alice',
    role: 'admin' as const,
    tenantId: null,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };

  it('parses a valid user', () => {
    const result = UserSchema.parse(validUser);
    expect(result.id).toBe('u-1');
    expect(result.email).toBe('alice@example.com');
    expect(result.role).toBe('admin');
  });

  it('accepts all valid roles', () => {
    for (const role of ['admin', 'editor', 'viewer'] as const) {
      expect(() => UserSchema.parse({ ...validUser, role })).not.toThrow();
    }
  });

  it('rejects invalid email', () => {
    expect(() => UserSchema.parse({ ...validUser, email: 'not-an-email' })).toThrow();
  });

  it('rejects invalid role', () => {
    expect(() => UserSchema.parse({ ...validUser, role: 'superuser' })).toThrow();
  });

  it('allows tenantId to be null', () => {
    const result = UserSchema.parse({ ...validUser, tenantId: null });
    expect(result.tenantId).toBeNull();
  });

  it('allows tenantId to be a string', () => {
    const result = UserSchema.parse({ ...validUser, tenantId: 'tenant-abc' });
    expect(result.tenantId).toBe('tenant-abc');
  });
});

describe('RoleSchema', () => {
  const validRole = {
    id: 'r-1',
    name: 'admin' as const,
    description: 'Full access',
    permissions: '["read","write","delete"]',
    tenantId: null,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };

  it('parses a valid role', () => {
    const result = RoleSchema.parse(validRole);
    expect(result.name).toBe('admin');
    expect(result.permissions).toBe('["read","write","delete"]');
  });

  it('accepts all valid role names', () => {
    for (const name of ['admin', 'editor', 'viewer'] as const) {
      expect(() => RoleSchema.parse({ ...validRole, name })).not.toThrow();
    }
  });

  it('rejects invalid name', () => {
    expect(() => RoleSchema.parse({ ...validRole, name: 'owner' })).toThrow();
  });
});

describe('ApiKeySchema', () => {
  const validKey = {
    id: 'k-1',
    name: 'CI key',
    keyHash: 'sha256hash',
    userId: null,
    role: 'admin' as const,
    scopes: null,
    lastUsedAt: null,
    expiresAt: null,
    revokedAt: null,
    tenantId: null,
    createdAt: '2024-01-01T00:00:00Z',
  };

  it('parses a valid api key', () => {
    const result = ApiKeySchema.parse(validKey);
    expect(result.id).toBe('k-1');
    expect(result.keyHash).toBe('sha256hash');
    expect(result.role).toBe('admin');
  });

  it('allows userId to be null', () => {
    const result = ApiKeySchema.parse({ ...validKey, userId: null });
    expect(result.userId).toBeNull();
  });

  it('allows userId to be a string', () => {
    const result = ApiKeySchema.parse({ ...validKey, userId: 'u-1' });
    expect(result.userId).toBe('u-1');
  });

  it('allows all optional nullable fields to be null', () => {
    const result = ApiKeySchema.parse(validKey);
    expect(result.scopes).toBeNull();
    expect(result.lastUsedAt).toBeNull();
    expect(result.expiresAt).toBeNull();
    expect(result.revokedAt).toBeNull();
    expect(result.tenantId).toBeNull();
  });

  it('rejects invalid role', () => {
    expect(() => ApiKeySchema.parse({ ...validKey, role: 'god' })).toThrow();
  });
});
