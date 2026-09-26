/**
 * Permissions, derived from the contract.
 *
 * This used to be a second hand-written table with only two values in common
 * with `shared-contracts`' `PermissionSchema`, and the two disagreed about what
 * administrative authority looks like: this module issued `admin:all` while the
 * contract issued `admin`, and `checkPermission` looked only for the former — so
 * a session carrying the contract's own `admin` was granted nothing.
 *
 * The named constants are now derived from the contract list with `satisfies`,
 * so a permission added to one side and not the other is a compile error rather
 * than a token that validates in one place and throws in the other.
 */
import {
  isAdminPermission,
  PERMISSIONS,
  type Permission as ContractPermission,
} from '@automate/shared-contracts';

export const Permission = {
  RUNS_READ: 'runs:read',
  RUNS_WRITE: 'runs:write',
  TESTS_READ: 'tests:read',
  TESTS_WRITE: 'tests:write',
  SETTINGS_READ: 'settings:read',
  SETTINGS_WRITE: 'settings:write',
  VAULT_READ: 'vault:read',
  VAULT_WRITE: 'vault:write',
  AI_USE: 'ai:use',
  CONNECTORS_MANAGE: 'connectors:manage',
  ADMIN: 'admin',
  ADMIN_ALL: 'admin:all',
} as const satisfies Record<string, ContractPermission>;

/** Every permission, in the contract's order. */
export const ALL_PERMISSIONS: readonly ContractPermission[] = PERMISSIONS;

export type Permission = ContractPermission;

/**
 * Whether a granted set satisfies a requirement.
 *
 * Administrative authority is either spelling: `admin` from the unified session
 * contract, `admin:all` from the legacy key format. Accepting only one of them
 * is how a session with full authority ended up with none.
 */
export function checkPermission(
  userPermissions: readonly string[],
  required: ContractPermission,
): boolean {
  if (userPermissions.some(isAdminPermission)) return true;
  return userPermissions.includes(required);
}

/** Whether a granted set carries administrative authority, either spelling. */
export function isAdmin(userPermissions: readonly string[]): boolean {
  return userPermissions.some(isAdminPermission);
}
