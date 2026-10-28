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

type Person = {
  id: string;
  email: string;
  displayName: string;
  disabledAt: Date | null;
  lastLoginAt: Date | null;
};

const PERSON = {
  id: users.id,
  email: users.email,
  displayName: users.displayName,
  disabledAt: users.disabledAt,
  lastLoginAt: users.lastLoginAt,
};

/**
 * How often a sign-in rewrites a person's row when nothing about them changed. OIDC signs in
 * once a session, so it is `0`: every sign-in is recorded. Cloudflare Access has no sign-in
 * event — every request carries the identity — so its people are recorded at most this often,
 * rather than with a write per request.
 */
export interface SignInTouch {
  afterMs?: number;
}

/**
 * The person these claims sign in: by issuer and subject, or — for a person SCIM provisioned,
 * who has no issuer yet — by email, linking the row to this identity on their first sign-in.
 * Only a row with no issuer is linked, so a second provider cannot take over a first one's.
 */
async function findPerson(
  options: Options,
  claims: SignInClaims,
  email: string,
  now: Date,
): Promise<Person | undefined> {
  const [known] = await options.db
    .select(PERSON)
    .from(users)
    .where(and(eq(users.issuer, claims.issuer), eq(users.subject, claims.subject)))
    .limit(1);
  if (known !== undefined) return known;
  const [provisioned] = await options.db
    .select(PERSON)
    .from(users)
    .where(and(eq(users.email, email), isNull(users.issuer)))
    .limit(1);
  if (provisioned === undefined) return undefined;
  await options.db
    .update(users)
    .set({ issuer: claims.issuer, subject: claims.subject, updatedAt: now })
    .where(eq(users.id, provisioned.id));
  return provisioned;
}

/** A person's membership in this workspace, if they have one. */
async function membershipOf(
  options: Options,
  person: Person | undefined,
): Promise<{ role: AccessRole } | undefined> {
  if (person === undefined) return undefined;
  const [membership] = await options.db
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, options.workspaceId),
        eq(workspaceMembers.userId, person.id),
      ),
    )
    .limit(1);
  return membership;
}

/**
 * A new person's row, or `null` when another identity already holds the email: linking the two
 * by email would let a second provider sign in as the first provider's person.
 */
async function createPerson(
  options: Options,
  claims: SignInClaims,
  email: string,
  now: Date,
): Promise<string | null> {
  const [taken] = await options.db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (taken !== undefined) return null;
  const [created] = await options.db
    .insert(users)
    .values({
      email,
      displayName: claims.name?.trim() || email,
      issuer: claims.issuer,
      subject: claims.subject,
      lastLoginAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: users.id });
  if (created === undefined) throw new Error('the user row was not created');
  return created.id;
}

/**
 * Records a returning person: their email and name as the provider says them now, and when
 * they were last seen. A provider that sends no name leaves the one already there — the one an
 * admin or SCIM set — rather than replacing it with the email. Nothing is written when nothing
 * changed and the last sign-in is within `afterMs`.
 */
async function touchPerson(
  options: Options,
  person: Person,
  claims: SignInClaims,
  email: string,
  now: Date,
  afterMs: number,
): Promise<void> {
  const displayName = claims.name?.trim() || person.displayName;
  const changed = person.email !== email || person.displayName !== displayName;
  const seen = person.lastLoginAt?.getTime() ?? Number.NEGATIVE_INFINITY;
  if (!changed && now.getTime() - seen < afterMs) return;
  await options.db
    .update(users)
    .set({ email, displayName, lastLoginAt: now, updatedAt: now })
    .where(eq(users.id, person.id));
}

/** The person's membership here, created or moved to `role` when it is not already. */
async function ensureMembership(
  options: Options,
  userId: string,
  membership: { role: AccessRole } | undefined,
  role: AccessRole,
  now: Date,
): Promise<void> {
  if (membership === undefined) {
    await options.db.insert(workspaceMembers).values({
      workspaceId: options.workspaceId,
      userId,
      role,
      invitedBy: 'sign-in',
      createdAt: now,
    });
    return;
  }
  if (membership.role === role) return;
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
  touch: SignInTouch = {},
): Promise<SignInOutcome> {
  const email = claims.email.toLowerCase();
  const existing = await findPerson(options, claims, email, now);
  if (existing?.disabledAt) return { ok: false, reason: 'disabled' };

  const mapped = ruleRoleFor(
    { email, groups: claims.groups, serviceTokenId: null },
    policy.roleMap,
  );
  const membership = await membershipOf(options, existing);
  const role: AccessRole | null = mapped ?? membership?.role ?? policy.defaultRole;
  if (role === null) return { ok: false, reason: 'not-invited' };

  let userId: string | null;
  if (existing === undefined) {
    userId = await createPerson(options, claims, email, now);
    if (userId === null) return { ok: false, reason: 'email-taken' };
  } else {
    userId = existing.id;
    await touchPerson(options, existing, claims, email, now, touch.afterMs ?? 0);
  }
  await ensureMembership(options, userId, membership, role, now);
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
