/**
 * plugins/rbac.ts — Role-Based Access Control middleware.
 *
 * Decorates every FastifyRequest with a `userRole` property.
 * When the 'rbac' feature flag is ON, role is resolved per-request from:
 *   1. Bearer API key   → SHA-256 hash → DB lookup → role
 *   2. Session cookie   → parse keyId (first ':'-segment) → DB lookup → role
 *   3. Fallback         → 'viewer'
 *
 * When flag is OFF, all requests get role 'admin' (backward-compatible).
 *
 * Exports two preHandler factories:
 *   requireRole('admin', 'editor')   — allow listed roles
 *   requirePermission('write')       — allow roles that have the permission
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { db } from '../db/client.js';
import { apiKeys } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { hashApiKey } from '../services/api-key-db.js';
import { isEnabled } from '../services/feature-flags.js';
import { SESSION_COOKIE_NAME } from '../services/auth.js';

export type UserRole = 'admin' | 'editor' | 'viewer';

declare module 'fastify' {
  interface FastifyRequest {
    userRole: UserRole;
  }
}

// ── Per-role permission matrix ────────────────────────────────────────────────
const ROLE_PERMISSIONS: Record<UserRole, string[]> = {
  admin: ['*'],
  editor: ['read', 'write', 'quarantine.edit', 'gate.edit', 'run.manage'],
  viewer: ['read'],
};

// ── Internal resolvers ────────────────────────────────────────────────────────

async function resolveRoleFromKey(rawKey: string): Promise<UserRole> {
  const hash = hashApiKey(rawKey);
  const rows = await db
    .select({ role: apiKeys.role })
    .from(apiKeys)
    .where(eq(apiKeys.keyHash, hash));
  if (rows.length > 0 && rows[0]) return rows[0].role as UserRole;
  return 'viewer';
}

async function resolveRoleFromKeyId(keyId: string): Promise<UserRole> {
  const rows = await db
    .select({ role: apiKeys.role })
    .from(apiKeys)
    .where(eq(apiKeys.id, keyId));
  if (rows.length > 0 && rows[0]) return rows[0].role as UserRole;
  return 'viewer';
}

// ── Plugin ────────────────────────────────────────────────────────────────────

export async function registerRbacPlugin(app: FastifyInstance): Promise<void> {
  // Default: 'admin' — keeps all existing behaviour when rbac flag is OFF.
  app.decorateRequest('userRole', 'admin' as UserRole);

  app.addHook('onRequest', async (request) => {
    // When flag is OFF every request is treated as admin (full backward compat).
    if (!isEnabled('rbac')) {
      request.userRole = 'admin';
      return;
    }

    const url = request.url;

    // Public / auth bootstrap endpoints — bypass role resolution.
    if (
      !url.startsWith('/api/') ||
      url.startsWith('/api/auth/') ||
      url.startsWith('/health')
    ) {
      request.userRole = 'admin';
      return;
    }

    // 1. Bearer API key path ─────────────────────────────────────────────────
    const authHeader = request.headers['authorization'];
    if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
      const rawKey = authHeader.slice(7);
      request.userRole = await resolveRoleFromKey(rawKey);
      return;
    }

    // 2. Session cookie path ─────────────────────────────────────────────────
    // Token format: `keyId:timestamp:signature` (see services/auth.ts)
    const sessionToken = request.cookies?.[SESSION_COOKIE_NAME];
    if (typeof sessionToken === 'string') {
      const keyId = sessionToken.split(':')[0];
      if (keyId) {
        request.userRole = await resolveRoleFromKeyId(keyId);
        return;
      }
    }

    // 3. Unauthenticated / unrecognised — minimum privilege.
    request.userRole = 'viewer';
  });
}

// ── Prehandler factories ──────────────────────────────────────────────────────

/**
 * Invalidate any in-memory permission cache.
 * Called after role mutations (create/update/delete) so that subsequent
 * requests pick up the latest permissions.
 * Currently a no-op — permissions are resolved per-request from the DB.
 * Exported so callers don't need to guard against future caching.
 */
export function invalidatePermissionCache(): void {
  // No-op: permissions are resolved per-request; no cache to invalidate.
}

/**
 * Prehandler that returns 403 when the caller's role is not in `allowedRoles`.
 * No-op when the 'rbac' feature flag is OFF.
 */
export function requireRole(...allowedRoles: UserRole[]) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!isEnabled('rbac')) return;
    if (!allowedRoles.includes(req.userRole)) {
      await reply.status(403).send({
        error: 'Forbidden',
        message: `Role '${req.userRole}' does not have permission for this action`,
      });
    }
  };
}

/**
 * Prehandler that returns 403 when the caller's role does not possess ALL of
 * the listed permissions.  No-op when the 'rbac' feature flag is OFF.
 */
export function requirePermission(...permissions: string[]) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!isEnabled('rbac')) return;
    const perms = ROLE_PERMISSIONS[req.userRole] ?? [];
    const hasAll = permissions.every((p) => perms.includes('*') || perms.includes(p));
    if (!hasAll) {
      await reply.status(403).send({
        error: 'Forbidden',
        message: `Insufficient permissions. Required: ${permissions.join(', ')}`,
      });
    }
  };
}
