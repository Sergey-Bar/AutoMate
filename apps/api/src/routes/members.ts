import { Hono, type Context } from 'hono';
import { and, asc, eq, ne } from 'drizzle-orm';
import { z } from 'zod/v4';
import { DrizzleSessionStore, users, workspaceMembers } from '@automate/db';
import { DomainError, ErrorCode } from '../errors/domain-error.js';
import { callerOf, requireRole, type CallerResolver } from '../http/roles.js';
import { audit } from '../services/access-service.js';
import type { ProjectRegistryServiceOptions } from '../services/project-registry-service.js';

/**
 * Members (ADR-014, team): the people who signed in with single sign-on, and what each may do
 * in this workspace. Admin only, and every change is an audit row.
 *
 * - `GET /api/v1/members` — everyone with a role here.
 * - `PATCH /api/v1/members/:userId` — `{ role }` and/or `{ disabled }`. Disabling a person
 *   revokes every session they hold, at once; they cannot sign in again until enabled.
 * - `DELETE /api/v1/members/:userId` — removes the role here and revokes their sessions.
 *
 * The workspace's last enabled admin can be neither demoted, disabled nor removed, so an
 * install cannot lock its own admins out. A person in another workspace is a 404.
 */
export interface MembersRouteOptions extends Pick<
  ProjectRegistryServiceOptions,
  'db' | 'workspaceId'
> {
  access: CallerResolver;
}

const PatchSchema = z
  .object({
    role: z.enum(['viewer', 'operator', 'admin']).optional(),
    disabled: z.boolean().optional(),
  })
  .refine((body) => body.role !== undefined || body.disabled !== undefined, {
    message: 'name a role, or whether the person is disabled',
  });

const UserIdSchema = z.string().uuid();

function invalid(context: Context, message: string, details: unknown) {
  return context.json({ error: { code: ErrorCode.INVALID_REQUEST_BODY, message, details } }, 400);
}

export function createMembersRoutes(options: MembersRouteOptions): Hono {
  const app = new Hono();
  const admin = requireRole('admin', options.access);
  const sessions = new DrizzleSessionStore(options.db as never);
  const here = eq(workspaceMembers.workspaceId, options.workspaceId);

  /** The person's membership here, or a 404: a person elsewhere is not addressable. */
  const membership = async (userId: string) => {
    if (!UserIdSchema.safeParse(userId).success) {
      throw new DomainError(ErrorCode.NOT_FOUND, 'No such member');
    }
    const [row] = await options.db
      .select({ role: workspaceMembers.role, disabledAt: users.disabledAt })
      .from(workspaceMembers)
      .innerJoin(users, eq(users.id, workspaceMembers.userId))
      .where(and(here, eq(workspaceMembers.userId, userId)))
      .limit(1);
    if (row === undefined) throw new DomainError(ErrorCode.NOT_FOUND, 'No such member');
    return row;
  };

  /** Refuses a change that would leave the workspace with no enabled admin. */
  const keepAnAdmin = async (
    userId: string,
    current: { role: string; disabledAt: Date | null },
  ) => {
    if (current.role !== 'admin' || current.disabledAt !== null) return;
    const others = await options.db
      .select({ id: workspaceMembers.userId, disabledAt: users.disabledAt })
      .from(workspaceMembers)
      .innerJoin(users, eq(users.id, workspaceMembers.userId))
      .where(and(here, eq(workspaceMembers.role, 'admin'), ne(workspaceMembers.userId, userId)));
    if (!others.some((other) => other.disabledAt === null)) {
      throw new DomainError(
        'LAST_ADMIN',
        'This is the last admin here: make someone else an admin first',
      );
    }
  };

  const record = async (context: Context, action: string, userId: string, details = {}) =>
    audit(options, {
      actor: (await callerOf(context, options.access)).actor,
      action,
      resourceType: 'user',
      resourceId: userId,
      details,
    });

  app.get('/api/v1/members', admin, async (context) => {
    const rows = await options.db
      .select({
        userId: users.id,
        email: users.email,
        displayName: users.displayName,
        role: workspaceMembers.role,
        disabledAt: users.disabledAt,
        lastLoginAt: users.lastLoginAt,
        joinedAt: workspaceMembers.createdAt,
      })
      .from(workspaceMembers)
      .innerJoin(users, eq(users.id, workspaceMembers.userId))
      .where(here)
      .orderBy(asc(users.email));
    return context.json({
      members: rows.map((row) => ({
        userId: row.userId,
        email: row.email,
        displayName: row.displayName,
        role: row.role,
        disabled: row.disabledAt !== null,
        lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
        joinedAt: row.joinedAt.toISOString(),
      })),
    });
  });

  app.patch('/api/v1/members/:userId', admin, async (context) => {
    const userId = context.req.param('userId');
    const parsed = PatchSchema.safeParse(await context.req.json().catch(() => null));
    if (!parsed.success) return invalid(context, 'Invalid member change', parsed.error.issues);
    const current = await membership(userId);
    const demoted = parsed.data.role !== undefined && parsed.data.role !== 'admin';
    if (demoted || parsed.data.disabled === true) await keepAnAdmin(userId, current);
    if (parsed.data.role !== undefined && parsed.data.role !== current.role) {
      await options.db
        .update(workspaceMembers)
        .set({ role: parsed.data.role })
        .where(and(here, eq(workspaceMembers.userId, userId)));
      await record(context, 'member.role', userId, { from: current.role, to: parsed.data.role });
    }
    if (parsed.data.disabled !== undefined) {
      const now = new Date();
      await options.db
        .update(users)
        .set({ disabledAt: parsed.data.disabled ? now : null, updatedAt: now })
        .where(eq(users.id, userId));
      if (parsed.data.disabled) await sessions.revokeForUser(userId, now);
      await record(context, parsed.data.disabled ? 'member.disable' : 'member.enable', userId);
    }
    return context.json({ ok: true });
  });

  app.delete('/api/v1/members/:userId', admin, async (context) => {
    const userId = context.req.param('userId');
    const current = await membership(userId);
    await keepAnAdmin(userId, current);
    await options.db.delete(workspaceMembers).where(and(here, eq(workspaceMembers.userId, userId)));
    await sessions.revokeForUser(userId, new Date());
    await record(context, 'member.remove', userId, { role: current.role });
    return context.json({ ok: true });
  });

  return app;
}
