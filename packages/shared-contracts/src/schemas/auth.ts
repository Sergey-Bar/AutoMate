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

export const PermissionSchema = z.enum([
  'runs:read',
  'runs:write',
  'tests:read',
  'tests:write',
  'settings:read',
  'settings:write',
  'admin',
]);
export type Permission = z.infer<typeof PermissionSchema>;

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
