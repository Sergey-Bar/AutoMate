/**
 * Auth domain schemas — Zod v4
 *
 * Covers unified session, API keys, service keys, token validation,
 * permissions, and JWT claims for cross-service auth contracts.
 */
import { z } from 'zod/v4';

// ---------------------------------------------------------------------------
// Permission
// ---------------------------------------------------------------------------

/**
 * The one permission vocabulary.
 *
 * `packages/auth/src/permissions.ts` used to declare a *second* table with only
 * two values in common, so `PermissionSchema.parse(['vault:read'])` threw —
 * inside `JwtClaimsSchema`, `UnifiedSessionSchema`, `ApiKeySchema` and
 * `ServiceKeySchema`, four schemas that are on the real API boundary. A token
 * minted with a perfectly valid permission was rejected by the contract that
 * describes it.
 *
 * This is the authority because it is the one the boundary schemas validate
 * against. `packages/auth` derives its named constants from this list with
 * `satisfies`, so adding a permission here and forgetting the other side is a
 * compile error rather than a runtime 500.
 */
export const PERMISSIONS = [
  'runs:read',
  'runs:write',
  'tests:read',
  'tests:write',
  'settings:read',
  'settings:write',
  'vault:read',
  'vault:write',
  'ai:use',
  'connectors:manage',
  // Both spellings of administrative authority, because both are issued:
  // `admin` by the unified session contract, `admin:all` by the auth package's
  // constant. `checkPermission` used to look only for `admin:all`, so a session
  // carrying the contract's own `admin` was granted nothing.
  'admin',
  'admin:all',
] as const;

export const PermissionSchema = z.enum(PERMISSIONS);
export type Permission = (typeof PERMISSIONS)[number];

/** True for either spelling of administrative authority. */
export function isAdminPermission(value: string): boolean {
  return value === 'admin' || value === 'admin:all';
}

// ---------------------------------------------------------------------------
// JwtClaims
// ---------------------------------------------------------------------------

export const JwtClaimsSchema = z.object({
  sub: z.string(),
  iss: z.string(),
  aud: z.string(),
  iat: z.number(),
  exp: z.number(),
  permissions: z.array(PermissionSchema).optional(),
  tenantId: z.string().optional(),
});
export type JwtClaims = z.infer<typeof JwtClaimsSchema>;

// ---------------------------------------------------------------------------
// UnifiedSession
// ---------------------------------------------------------------------------

export const UnifiedSessionSchema = z.object({
  sessionId: z.string(),
  userId: z.string(),
  tenantId: z.string().optional(),
  permissions: z.array(PermissionSchema),
  createdAt: z.string(),
  expiresAt: z.string(),
});
export type UnifiedSession = z.infer<typeof UnifiedSessionSchema>;

// ---------------------------------------------------------------------------
// ApiKey
// ---------------------------------------------------------------------------

export const ApiKeySchema = z.object({
  id: z.string(),
  name: z.string(),
  keyHash: z.string(),
  userId: z.string().optional(),
  permissions: z.array(PermissionSchema),
  lastUsedAt: z.string().optional(),
  expiresAt: z.string().optional(),
  revokedAt: z.string().optional(),
  createdAt: z.string(),
});
export type ApiKey = z.infer<typeof ApiKeySchema>;

// ---------------------------------------------------------------------------
// ServiceKey
// ---------------------------------------------------------------------------

export const ServiceKeySchema = z.object({
  serviceId: z.string(),
  serviceName: z.string(),
  keyHash: z.string(),
  permissions: z.array(PermissionSchema),
  expiresAt: z.string().optional(),
  createdAt: z.string(),
});
export type ServiceKey = z.infer<typeof ServiceKeySchema>;

// ---------------------------------------------------------------------------
// TokenValidation
// ---------------------------------------------------------------------------

export const TokenValidationSchema = z.object({
  valid: z.boolean(),
  reason: z.string().optional(),
  claims: JwtClaimsSchema.optional(),
  expiresAt: z.string().optional(),
});
export type TokenValidation = z.infer<typeof TokenValidationSchema>;
