export const Permission = {
  RUNS_READ: 'runs:read',
  RUNS_WRITE: 'runs:write',
  VAULT_READ: 'vault:read',
  VAULT_WRITE: 'vault:write',
  AI_USE: 'ai:use',
  CONNECTORS_MANAGE: 'connectors:manage',
  ADMIN_ALL: 'admin:all',
} as const;

export type Permission = (typeof Permission)[keyof typeof Permission];

export function checkPermission(userPermissions: string[], required: Permission): boolean {
  if (userPermissions.includes(Permission.ADMIN_ALL)) return true;
  return userPermissions.includes(required);
}
