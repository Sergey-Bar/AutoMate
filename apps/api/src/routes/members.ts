import { Hono, type Context } from 'hono';
import { and, asc, eq, isNull, ne } from 'drizzle-orm';
import { z } from 'zod/v4';
import { DrizzleSessionStore, users, workspaceMembers } from '@automate/db';
import { DomainError, ErrorCode } from '../errors/domain-error.js';
import {
  callerOf,
  isInstallationAdmin,
  requireRole,
  sourceOf,
  type CallerResolver,
} from '../http/roles.js';
import { audit, revokeTokensMadeBy, type Caller } from '../services/access-service.js';
import type { ProjectRegistryServiceOptions } from '../services/project-registry-service.js';
import { isEnabledAdmin, memberElsewhere } from '../services/user-service.js';

/**
 * Members (ADR-014, team): the people who signed in with single sign-on, and what each may do
 * in this workspace. Admin only, and every change is an audit row.
 *
 * - `GET /api/v1/members` — everyone with a role here.
 * - `POST /api/v1/members` — `{ email, role }`: a person who has signed in before, added here.
 * - `PATCH /api/v1/members/:userId` — `{ role }` and/or `{ disabled }`. Disabling a person
 *   revokes every session they hold, at once; they cannot sign in again until enabled.
 * - `DELETE /api/v1/members/:userId` — removes the role here, and nothing else. Roles are read
 *   per request, so the person has none here from their next one, and their sessions still
 *   serve the workspaces they remain in.
 *
 * **A person is one account across the installation; a membership is one workspace's.** The
 * role here is this workspace's admins' to change. The account — whether the person is
 * disabled — is decided by the installation's own admin and the default workspace's admins,
 * and by this workspace's admins only for a person who is a member of no other workspace.
 * Otherwise an admin of any workspace could add someone by email and lock them out of all.
 *
 * The workspace's last enabled admin can be neither demoted nor removed, and nobody can be
 * disabled while they are the last enabled admin of any workspace, so an install cannot lock
 * its own admins out. A person in another workspace only is a 404.
 */
export interface MembersRouteOptions extends Pick<
  ProjectRegistryServiceOptions,
  'db' | 'workspaceId'
> {
  access: CallerResolver;
  /** The installation's default workspace, whose admins decide every person's account. */
  defaultWorkspace: string;
}

const PatchSchema = z
  .object({
    role: z.enum(['viewer', 'operator', 'admin']).optional(),
    disabled: z.boolean().optional(),
  })
  .refine((body) => body.role !== undefined || body.disabled !== undefined, {
    message: 'name a role, or whether the person is disabled',
  });

const AddSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  role: z.enum(['viewer', 'operator', 'admin']),
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

  /** Whether the workspace has an enabled admin other than this person. */
  const anotherAdminIn = async (workspaceId: string, userId: string): Promise<boolean> => {
    const [another] = await options.db
      .select({ id: workspaceMembers.userId })
      .from(workspaceMembers)
      .innerJoin(users, eq(users.id, workspaceMembers.userId))
      .where(
        and(
          eq(workspaceMembers.workspaceId, workspaceId),
          eq(workspaceMembers.role, 'admin'),
          ne(workspaceMembers.userId, userId),
          isNull(users.disabledAt),
        ),
      )
      .limit(1);
    return another !== undefined;
  };

  /** Refuses a demotion or a removal that would leave this workspace with no enabled admin. */
  const keepAnAdmin = async (
    userId: string,
    current: { role: string; disabledAt: Date | null },
  ) => {
    if (current.role !== 'admin' || current.disabledAt !== null) return;
    if (!(await anotherAdminIn(options.workspaceId, userId))) {
      throw new DomainError(
        'LAST_ADMIN',
        'This is the last admin here: make someone else an admin first',
      );
    }
  };

  /**
   * Refuses disabling the last enabled admin of any workspace, not only this one: the account
   * is installation-wide, so disabling it empties every workspace the person runs.
   */
  const keepEveryAdmin = async (userId: string, current: { disabledAt: Date | null }) => {
    if (current.disabledAt !== null) return;
    const adminOf = await options.db
      .select({ workspaceId: workspaceMembers.workspaceId })
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.userId, userId), eq(workspaceMembers.role, 'admin')));
    for (const { workspaceId } of adminOf) {
      if (await anotherAdminIn(workspaceId, userId)) continue;
      throw new DomainError(
        'LAST_ADMIN',
        workspaceId === options.workspaceId
          ? 'This is the last admin here: make someone else an admin first'
          : `This person is the last admin of ${workspaceId}: make someone else an admin there first`,
        { details: { workspaceId } },
      );
    }
  };

  /** Whether the caller is a person who is an enabled admin of the default workspace. */
  const isDefaultAdmin = async (caller: Caller): Promise<boolean> => {
    const userId = sourceOf(caller) === 'user' ? caller.actor.slice('user:'.length) : '';
    if (!UserIdSchema.safeParse(userId).success) return false;
    return isEnabledAdmin({ db: options.db, workspaceId: options.defaultWorkspace }, userId);
  };

  /** Refuses a change to the person's account from a caller who decides only the membership. */
  const mayChangeAccount = async (context: Context, userId: string): Promise<void> => {
    const caller = await callerOf(context, options.access);
    if (isInstallationAdmin(caller)) return;
    if (!(await memberElsewhere(options, userId))) return;
    if (await isDefaultAdmin(caller)) return;
    throw new DomainError(
      ErrorCode.FORBIDDEN,
      'This person also belongs to another workspace: only the admin of the installation or ' +
        'of the default workspace can disable or enable them',
    );
  };

  const record = async (context: Context, action: string, userId: string, details = {}) =>
    audit(options, {
      actor: (await callerOf(context, options.access)).actor,
      action,
      resourceType: 'user',
      resourceId: userId,
      details,
    });

  /**
   * Disables or enables the account. Disabling signs the person out of every session at once
   * and revokes every access token they made, in every workspace (PRO-17).
   */
  const setDisabled = async (context: Context, userId: string, disabled: boolean) => {
    const now = new Date();
    await options.db
      .update(users)
      .set({ disabledAt: disabled ? now : null, updatedAt: now })
      .where(eq(users.id, userId));
    if (!disabled) return record(context, 'member.enable', userId);
    await sessions.revokeForUser(userId, now);
    const tokensRevoked = await revokeTokensMadeBy(options.db, userId, 'everywhere', now);
    return record(context, 'member.disable', userId, { tokensRevoked });
  };

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

  app.post('/api/v1/members', admin, async (context) => {
    const parsed = AddSchema.safeParse(await context.req.json().catch(() => null));
    if (!parsed.success) return invalid(context, 'Name an email and a role', parsed.error.issues);
    const [person] = await options.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, parsed.data.email))
      .limit(1);
    if (person === undefined) {
      throw new DomainError(
        ErrorCode.NOT_FOUND,
        'Nobody with that email has signed in yet: ask them to sign in once, then add them',
      );
    }
    const added = await options.db
      .insert(workspaceMembers)
      .values({
        workspaceId: options.workspaceId,
        userId: person.id,
        role: parsed.data.role,
        invitedBy: (await callerOf(context, options.access)).actor,
      })
      .onConflictDoNothing()
      .returning({ userId: workspaceMembers.userId });
    if (added.length === 0) throw new DomainError(ErrorCode.CONFLICT, 'Already a member here');
    await record(context, 'member.add', person.id, { role: parsed.data.role });
    return context.json({ userId: person.id, role: parsed.data.role }, 201);
  });

  app.patch('/api/v1/members/:userId', admin, async (context) => {
    const userId = context.req.param('userId');
    const parsed = PatchSchema.safeParse(await context.req.json().catch(() => null));
    if (!parsed.success) return invalid(context, 'Invalid member change', parsed.error.issues);
    const { role, disabled } = parsed.data;
    const current = await membership(userId);
    // Every check before any write, so a change refused in part is refused whole.
    if (disabled !== undefined) await mayChangeAccount(context, userId);
    if (role !== undefined && role !== 'admin') await keepAnAdmin(userId, current);
    if (disabled === true) await keepEveryAdmin(userId, current);
    if (role !== undefined && role !== current.role) {
      await options.db
        .update(workspaceMembers)
        .set({ role })
        .where(and(here, eq(workspaceMembers.userId, userId)));
      await record(context, 'member.role', userId, { from: current.role, to: role });
    }
    if (disabled !== undefined) await setDisabled(context, userId, disabled);
    return context.json({ ok: true });
  });

  app.delete('/api/v1/members/:userId', admin, async (context) => {
    const userId = context.req.param('userId');
    const current = await membership(userId);
    await keepAnAdmin(userId, current);
    // The membership, and the tokens they made here: their sessions and account are not ours
    // to end, but a credential they made for this workspace should not outlive their place in it.
    await options.db.delete(workspaceMembers).where(and(here, eq(workspaceMembers.userId, userId)));
    const tokensRevoked = await revokeTokensMadeBy(options.db, userId, {
      workspaceId: options.workspaceId,
    });
    await record(context, 'member.remove', userId, { role: current.role, tokensRevoked });
    return context.json({ ok: true });
  });

  return app;
}
