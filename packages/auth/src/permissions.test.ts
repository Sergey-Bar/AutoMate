import { checkPermission, Permission } from './permissions.js';

describe('checkPermission', () => {
  it('returns true when user has the required permission', () => {
    expect(checkPermission(['runs:read'], Permission.RUNS_READ)).toBe(true);
  });

  it('returns false when user does not have the required permission', () => {
    expect(checkPermission(['runs:read'], Permission.VAULT_WRITE)).toBe(false);
  });

  it('returns true for any permission when user has admin:all', () => {
    expect(checkPermission(['admin:all'], Permission.VAULT_WRITE)).toBe(true);
  });

  it('returns false when user has no permissions', () => {
    expect(checkPermission([], Permission.RUNS_READ)).toBe(false);
  });

  it('returns true when user has multiple permissions including the required one', () => {
    expect(checkPermission(['runs:read', 'vault:read'], Permission.VAULT_READ)).toBe(true);
  });

  it('returns false when user has unrelated permissions', () => {
    expect(checkPermission(['runs:read', 'vault:read'], Permission.AI_USE)).toBe(false);
  });
});
