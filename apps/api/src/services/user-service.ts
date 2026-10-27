import { and, eq, isNull } from 'drizzle-orm';
import type { AccessRole, RoleRule } from '@automate/config';
import { users, workspaceMembers } from '@automate/db';
import { ruleRoleFor } from '../http/role-map.js';
import type { Caller, Role } from './access-service.js';
import type { ProjectRegistryServiceOptions } from './project-registry-service.js';

/**
 * People (ADR-014, the team profile): who signed in, and the role each holds in a workspace.
 *
 * One person is one `users` row per identity — the provider's issuer and the subject it
 * names them by, never the email, which a person can change and a provider can reuse. A role
 * is a `workspace_members` row, so the same person can be an admin in one workspace and a
 * viewer in another, and has no role at all in a workspace they were never added to.
 */
type Options = Pick<ProjectRegistryServiceOptions, 'db' | 'workspaceId'>;

export interface SignInClaims {
  issuer: string;
  subject: string;
  email: string;
  name: string | null;
  groups: readonly string[];
}

export interface SignInPolicy {
  roleMap: readonly RoleRule[];
  /** The role of a person no rule names, on their first sign-in; `null` admits only the named. */
  defaultRole: AccessRole | null;
}

export type SignInOutcome =
  | { ok: true; userId: string; role: AccessRole }
  | { ok: false; reason: 'disabled' | 'not-invited' | 'email-taken' };

/**
 * Finds or creates the person, then their membership here.
 *
 * - A person no rule names gets `defaultRole` on their first sign-in, and keeps whatever role
 *   an admin gives them after that.
 * - A person a rule names gets the rule's role on every sign-in: the role map is the identity
 *   provider's side of the decision, so a change there takes effect at the next sign-in.
 * - A disabled person is refused, and so is a new person when there is no default role.
 */
export async function signInPerson(
  options: Options,
  claims: SignInClaims,
  policy: SignInPolicy,
  now: Date = new Date(),
): Promise<SignInOutcome> {
  const email = claims.email.toLowerCase();
  const displayName = claims.name?.trim() || email;
  let [existing] = await options.db
    .select({ id: users.id, disabledAt: users.disabledAt })
    .from(users)
    .where(and(eq(users.issuer, claims.issuer), eq(users.subject, claims.subject)))
    .limit(1);
  if (existing === undefined) {
    // A person SCIM provisioned has no issuer yet: their first sign-in links the row by email.
    // Only a row with no issuer is linked, so a second provider cannot take over a first one's.
    const [provisioned] = await options.db
      .select({ id: users.id, disabledAt: users.disabledAt })
      .from(users)
      .where(and(eq(users.email, email), isNull(users.issuer)))
      .limit(1);
    if (provisioned !== undefined) {
      await options.db
        .update(users)
        .set({ issuer: claims.issuer, subject: claims.subject, updatedAt: now })
        .where(eq(users.id, provisioned.id));
      existing = provisioned;
    }
  }
  if (existing?.disabledAt) return { ok: false, reason: 'disabled' };

  const mapped = ruleRoleFor(
    { email, groups: claims.groups, serviceTokenId: null },
    policy.roleMap,
  );
  const [membership] =
    existing === undefined
      ? []
      : await options.db
          .select({ role: workspaceMembers.role })
          .from(workspaceMembers)
          .where(
            and(
              eq(workspaceMembers.workspaceId, options.workspaceId),
              eq(workspaceMembers.userId, existing.id),
            ),
          )
          .limit(1);
  const role: AccessRole | null = mapped ?? membership?.role ?? policy.defaultRole;
  if (role === null) return { ok: false, reason: 'not-invited' };

  let userId = existing?.id;
  if (userId === undefined) {
    const [taken] = await options.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    // Another identity already holds this email; linking the two by email would let a
    // second provider sign in as the first provider's person.
    if (taken !== undefined) return { ok: false, reason: 'email-taken' };
    const [created] = await options.db
      .insert(users)
      .values({
        email,
        displayName,
        issuer: claims.issuer,
        subject: claims.subject,
        lastLoginAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: users.id });
    userId = created?.id;
    if (userId === undefined) throw new Error('the user row was not created');
  } else {
    await options.db
      .update(users)
      .set({ email, displayName, lastLoginAt: now, updatedAt: now })
      .where(eq(users.id, userId));
  }

  if (membership === undefined) {
    await options.db.insert(workspaceMembers).values({
      workspaceId: options.workspaceId,
      userId,
      role,
      invitedBy: 'sign-in',
      createdAt: now,
    });
  } else if (membership.role !== role) {
    await options.db
      .update(workspaceMembers)
      .set({ role })
      .where(
        and(
          eq(workspaceMembers.workspaceId, options.workspaceId),
          eq(workspaceMembers.userId, userId),
        ),
      );
  }
  return { ok: true, userId, role };
}

/**
 * The caller a person's session is, in this workspace: their membership's role, or no role
 * when they have none here. `null` — nobody — for a person who is disabled or gone, so a
 * session outlives neither.
 */
export async function callerForUser(options: Options, userId: string): Promise<Caller | null> {
  const [row] = await options.db
    .select({ id: users.id, role: workspaceMembers.role })
    .from(users)
    .leftJoin(
      workspaceMembers,
      and(
        eq(workspaceMembers.userId, users.id),
        eq(workspaceMembers.workspaceId, options.workspaceId),
      ),
    )
    .where(and(eq(users.id, userId), isNull(users.disabledAt)))
    .limit(1);
  if (row === undefined) return null;
  return { actor: `user:${row.id}`, role: (row.role as Role | null) ?? null, uploaderFor: null };
}
