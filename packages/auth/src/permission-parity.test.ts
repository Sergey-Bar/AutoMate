import { describe, expect, it } from 'vitest';
import {
  ALL_PERMISSIONS,
  checkPermission,
  isAdmin,
  Permission,
  type Permission as ContractPermission,
} from './permissions.js';
import { isAdminPermission, PERMISSIONS, PermissionSchema } from '@automate/shared-contracts';

/**
 * `packages/auth` and `shared-contracts` used to declare two permission tables
 * with two values in common, and disagree about what administrative authority
 * looks like. The result: `PermissionSchema.parse(['vault:read'])` threw inside
 * `JwtClaimsSchema`, `UnifiedSessionSchema`, `ApiKeySchema` and
 * `ServiceKeySchema` — four schemas on the real API boundary — and
 * `checkPermission` granted nothing to a session carrying the contract's own
 * `admin`.
 *
 * These tests fail if the two drift apart again, which is the only thing that
 * made the divergence invisible.
 */
describe('the permission vocabulary has one authority', () => {
  it('accepts every permission the auth package declares', () => {
    for (const [name, value] of Object.entries(Permission)) {
      const parsed = PermissionSchema.safeParse(value);
      expect(parsed.success, `${name}='${value}' is rejected by the contract`).toBe(true);
    }
  });

  it('declares no permission the contract does not know', () => {
    const declared = new Set<string>(Object.values(Permission));
    for (const value of PERMISSIONS) {
      expect(declared.has(value), `${value} is in the contract but not in the auth package`).toBe(
        true,
      );
    }
  });

  it('agrees on the full set, in both directions', () => {
    const contract = new Set<string>(PERMISSIONS);
    for (const value of ALL_PERMISSIONS) expect(contract.has(value)).toBe(true);
    expect(ALL_PERMISSIONS.length).toBe(PERMISSIONS.length);
  });

  it('rejects a permission neither side declares', () => {
    expect(PermissionSchema.safeParse('delete:all').success).toBe(false);
    expect(PermissionSchema.safeParse('').success).toBe(false);
    expect(PermissionSchema.safeParse('RUNS:READ').success).toBe(false);
  });
});

describe('administrative authority is recognised in both spellings', () => {
  it('accepts the contract spelling and the legacy spelling alike', () => {
    // `checkPermission` used to look only for `admin:all`, so a session carrying
    // the contract's own `admin` was granted nothing at all.
    for (const admin of ['admin', 'admin:all']) {
      expect(checkPermission([admin], Permission.VAULT_WRITE), admin).toBe(true);
      expect(checkPermission([admin], Permission.RUNS_READ), admin).toBe(true);
      expect(isAdmin([admin]), admin).toBe(true);
    }
    expect(isAdminPermission('admin')).toBe(true);
    expect(isAdminPermission('admin:all')).toBe(true);
    expect(isAdminPermission('runs:read')).toBe(false);
  });

  it('is not a prefix match', () => {
    expect(isAdmin(['administer'])).toBe(false);
    expect(isAdmin(['admin:read'])).toBe(false);
    expect(checkPermission(['admin:read'], Permission.RUNS_READ)).toBe(false);
  });

  it('is not granted by an unrelated permission', () => {
    expect(checkPermission(['runs:read'], Permission.RUNS_READ)).toBe(true);
    expect(checkPermission(['runs:read'], Permission.VAULT_WRITE)).toBe(false);
    expect(checkPermission([], Permission.RUNS_READ)).toBe(false);
    expect(isAdmin(['runs:read'])).toBe(false);
  });
});

describe('the contract schemas accept every permission the code issues', () => {
  it('round-trips every named constant through the boundary schemas', () => {
    for (const value of Object.values(Permission) as ContractPermission[]) {
      expect(PermissionSchema.safeParse(value).success, value).toBe(true);
    }
  });
});
