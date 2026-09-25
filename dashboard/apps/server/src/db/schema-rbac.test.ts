import { describe, it, expect } from 'vitest';
import { users, roles, apiKeys } from './schema.js';

describe('RBAC schema tables', () => {
  it('users table has required columns', () => {
    const cols = Object.keys(users);
    expect(cols).toContain('id');
    expect(cols).toContain('email');
    expect(cols).toContain('displayName');
    expect(cols).toContain('role');
    expect(cols).toContain('createdAt');
    expect(cols).toContain('updatedAt');
  });

  it('roles table has required columns', () => {
    const cols = Object.keys(roles);
    expect(cols).toContain('id');
    expect(cols).toContain('name');
    expect(cols).toContain('description');
    expect(cols).toContain('permissions');
  });

  it('apiKeys table has required columns', () => {
    const cols = Object.keys(apiKeys);
    expect(cols).toContain('id');
    expect(cols).toContain('name');
    expect(cols).toContain('keyHash');
    expect(cols).toContain('userId');
    expect(cols).toContain('role');
    expect(cols).toContain('createdAt');
  });

  it('apiKeys table does not have a plaintext key column', () => {
    const cols = Object.keys(apiKeys);
    expect(cols).not.toContain('key');
    expect(cols).not.toContain('apiKey');
    expect(cols).not.toContain('plaintext');
  });
});
