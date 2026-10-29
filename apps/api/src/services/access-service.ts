import { createHash, randomBytes } from 'node:crypto';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { accessTokens, auditEvents, projects } from '@automate/db';
import { z } from 'zod/v4';
import { DomainError, ErrorCode } from '../errors/domain-error.js';
import { requestAuditFields } from '../observability/request-context.js';
import type { ProjectRegistryServiceOptions } from './project-registry-service.js';

/**
 * Roles, access tokens and the audit trail.
 *
 * ## Four roles, ordered, and one that is not on the ladder
 *
 * `viewer` reads, `operator` also registers repositories, starts scans and triages findings,
 * `admin` also issues and revokes tokens. `uploader` is off the ladder: it may only send
 * reports to the one project it is pinned to, which is what a CI pipeline needs and nothing
 * more — a leaked CI secret cannot read another repository's findings.
 *
 * ## A token is random, shown once, and stored as a hash
 *
 * 32 random bytes, so a fast hash is the right one: there is nothing to brute-force that a
 * slow hash would protect. The prefix is kept so a list can say which token is which.
 */
type Options = Pick<ProjectRegistryServiceOptions, 'db' | 'workspaceId'>;

export const ROLES = ['viewer', 'operator', 'admin'] as const;
export type Role = (typeof ROLES)[number];
export type TokenRole = Role | 'uploader';

export interface Caller {
  /** Who, for the audit trail: `session`, `token:<id>`, or `anonymous` when access is open. */
  actor: string;
  role: Role | null;
  /** Set for an uploader: the only project it may send reports to. */
  uploaderFor: string | null;
}

export function satisfies(caller: Caller, required: Role): boolean {
  if (caller.role === null) return false;
  return ROLES.indexOf(caller.role) >= ROLES.indexOf(required);
}

export const CreateAccessTokenBodySchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    role: z.enum(['viewer', 'operator', 'admin', 'uploader']),
    projectId: z.string().uuid().optional(),
  })
  .refine((body) => body.role !== 'uploader' || body.projectId !== undefined, {
    message: 'an uploader token is pinned to one project',
    path: ['projectId'],
  });

export const TOKEN_PREFIX = 'amt_';

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface AccessTokenSummary {
  id: string;
  name: string;
  role: TokenRole;
  projectId: string | null;
  displayPrefix: string;
  createdBy: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

function summary(row: typeof accessTokens.$inferSelect): AccessTokenSummary {
  return {
    id: row.id,
    name: row.name,
    role: row.role as TokenRole,
    projectId: row.projectId,
    displayPrefix: row.displayPrefix,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
  };
}

export async function createAccessToken(
  options: Options,
  body: z.infer<typeof CreateAccessTokenBodySchema>,
  actor: string,
): Promise<{ token: string; summary: AccessTokenSummary }> {
  if (body.projectId !== undefined) {
    const owned = await options.db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.workspaceId, options.workspaceId), eq(projects.id, body.projectId)))
      .limit(1);
    if (owned.length === 0)
      throw new DomainError(ErrorCode.NOT_FOUND, `No project ${body.projectId}`);
  }
  const token = `${TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
  const [row] = await options.db
    .insert(accessTokens)
    .values({
      workspaceId: options.workspaceId,
      name: body.name,
      role: body.role,
      projectId: body.projectId ?? null,
      tokenHash: hashToken(token),
      displayPrefix: token.slice(0, TOKEN_PREFIX.length + 6),
      createdBy: actor,
    })
    .returning();
  return { token, summary: summary(row as typeof accessTokens.$inferSelect) };
}

export async function listAccessTokens(options: Options): Promise<AccessTokenSummary[]> {
  const rows = await options.db
    .select()
    .from(accessTokens)
    .where(eq(accessTokens.workspaceId, options.workspaceId))
    .orderBy(desc(accessTokens.createdAt));
  return rows.map(summary);
}

export async function revokeAccessToken(options: Options, id: string): Promise<AccessTokenSummary> {
  if (!/^[0-9a-f-]{36}$/iu.test(id)) throw new DomainError(ErrorCode.NOT_FOUND, `No token ${id}`);
  const [row] = await options.db
    .update(accessTokens)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(accessTokens.workspaceId, options.workspaceId),
        eq(accessTokens.id, id),
        isNull(accessTokens.revokedAt),
      ),
    )
    .returning();
  if (row === undefined) throw new DomainError(ErrorCode.NOT_FOUND, `No live token ${id}`);
  return summary(row);
}

/**
 * Revokes the live access tokens a person made (PRO-17): the ones whose creator is
 * `user:<id>`, in one workspace when their membership there ends, or in every workspace when
 * their account is disabled. A token the installation's admin or another person made is the
 * workspace's and is untouched. Returns how many were revoked, for the audit row.
 */
export async function revokeTokensMadeBy(
  db: Options['db'],
  userId: string,
  scope: { workspaceId: string } | 'everywhere',
  now = new Date(),
): Promise<number> {
  const filters = [eq(accessTokens.createdBy, `user:${userId}`), isNull(accessTokens.revokedAt)];
  if (scope !== 'everywhere') filters.push(eq(accessTokens.workspaceId, scope.workspaceId));
  const revoked = await db
    .update(accessTokens)
    .set({ revokedAt: now })
    .where(and(...filters))
    .returning({ id: accessTokens.id });
  return revoked.length;
}

/** The caller a presented token makes, or `null` for one that is unknown or revoked. */
export async function authenticateToken(options: Options, token: string): Promise<Caller | null> {
  if (!token.startsWith(TOKEN_PREFIX)) return null;
  const [row] = await options.db
    .select()
    .from(accessTokens)
    .where(
      and(
        eq(accessTokens.workspaceId, options.workspaceId),
        eq(accessTokens.tokenHash, hashToken(token)),
        isNull(accessTokens.revokedAt),
      ),
    )
    .limit(1);
  if (row === undefined) return null;
  await options.db
    .update(accessTokens)
    .set({ lastUsedAt: new Date() })
    .where(eq(accessTokens.id, row.id));
  return row.role === 'uploader'
    ? { actor: `token:${row.id}`, role: null, uploaderFor: row.projectId }
    : { actor: `token:${row.id}`, role: row.role as Role, uploaderFor: null };
}

/**
 * One row in `audit_events` for a decision a person or a pipeline made.
 *
 * Never throws: a failed audit write is logged by the caller's boundary rather than undoing a
 * decision that has already been made.
 */
export async function audit(
  options: Options,
  entry: {
    actor: string;
    action: string;
    resourceType: string;
    resourceId: string;
    details?: Record<string, unknown>;
  },
): Promise<void> {
  const now = new Date();
  try {
    await options.db.insert(auditEvents).values({
      timestamp: now,
      actorId: entry.actor,
      // A token, a Cloudflare service token and a SCIM connection are machines.
      actorType:
        entry.actor.startsWith('token:') ||
        entry.actor.startsWith('cf-service:') ||
        entry.actor.startsWith('scim:')
          ? 'service'
          : 'user',
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId,
      details: entry.details ?? {},
      workspaceId: options.workspaceId,
      createdAt: now,
      // Where the decision came from. The chain columns are the database's to write.
      ...requestAuditFields(),
    });
  } catch {
    // The decision stands; an audit table that refuses a row is an operations problem.
  }
}
