import { and, eq, isNull, ne } from 'drizzle-orm';
import type { AccessRole, RoleRule } from '@automate/config';
import { users, workspaceMembers } from '@automate/db';
import { classifyDatabaseError } from '../errors/db-errors.js';
import { ErrorCode } from '../errors/domain-error.js';
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
  /**
   * The role a new person no rule names starts with, when their first sign-in makes their row.
   * `null` admits only the people a rule names and the people who are already members.
   */
  defaultRole: AccessRole | null;
}

/**
 * `role` is the person's role in this workspace, or `null` for a person admitted on their
 * membership of another: their role is then read in that workspace, per request.
 */
export type SignInOutcome =
  | { ok: true; userId: string; role: AccessRole | null }
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
  userId: string,
): Promise<{ role: AccessRole } | undefined> {
  const [membership] = await options.db
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, options.workspaceId),
        eq(workspaceMembers.userId, userId),
      ),
    )
    .limit(1);
  return membership;
}

/**
 * A new person's row, or `null` when another identity already holds the email: linking the two
 * by email would let a second provider sign in as the first provider's person.
 *
 * Two first sign-ins of one person at once — a Cloudflare person's first page load is several
 * requests — make one row: the second insert does nothing, and finds the first one's by the
 * identity, where it used to fail on the unique index and answer 409.
 */
async function createPerson(
  options: Options,
  claims: SignInClaims,
  email: string,
  now: Date,
): Promise<string | null> {
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
    .onConflictDoNothing()
    .returning({ id: users.id });
  if (created !== undefined) return created.id;
  const [same] = await options.db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.issuer, claims.issuer), eq(users.subject, claims.subject)))
    .limit(1);
  return same?.id ?? null;
}

/**
 * Records a returning person: their email and name as the provider says them now, and when
 * they were last seen. A provider that sends no name leaves the one already there — the one an
 * admin or SCIM set — rather than replacing it with the email. Nothing is written when nothing
 * changed and the last sign-in is within `afterMs`.
 *
 * `false` when the provider now names an email another person holds: the unique index refuses
 * the write, and the sign-in is refused as `email-taken` rather than failing as a conflict.
 */
async function touchPerson(
  options: Options,
  person: Person,
  claims: SignInClaims,
  email: string,
  now: Date,
  afterMs: number,
): Promise<boolean> {
  const displayName = claims.name?.trim() || person.displayName;
  const changed = person.email !== email || person.displayName !== displayName;
  const seen = person.lastLoginAt?.getTime() ?? Number.NEGATIVE_INFINITY;
  if (!changed && now.getTime() - seen < afterMs) return true;
  try {
    await options.db
      .update(users)
      .set({ email, displayName, lastLoginAt: now, updatedAt: now })
      .where(eq(users.id, person.id));
  } catch (error) {
    if (classifyDatabaseError(error).code === ErrorCode.DUPLICATE) return false;
    throw error;
  }
  return true;
}

/**
 * The person's membership here moved to `role`, or made with it. A concurrent sign-in of the
 * same person may make it first: the insert then does nothing, and the row it made is read.
 */
async function ensureMembership(
  options: Options,
  userId: string,
  role: AccessRole,
  now: Date,
  membership?: { role: AccessRole },
): Promise<void> {
  let current = membership;
  if (current === undefined) {
    const created = await options.db
      .insert(workspaceMembers)
      .values({
        workspaceId: options.workspaceId,
        userId,
        role,
        invitedBy: 'sign-in',
        createdAt: now,
      })
      .onConflictDoNothing()
      .returning({ role: workspaceMembers.role });
    if (created.length > 0) return;
    current = await membershipOf(options, userId);
  }
  if (current === undefined || current.role === role) return;
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

/** A first sign-in: the person's row and their membership here with `role`, or a refusal. */
async function signInNewPerson(
  options: Options,
  claims: SignInClaims,
  email: string,
  role: AccessRole | null,
  now: Date,
): Promise<SignInOutcome> {
  if (role === null) return { ok: false, reason: 'not-invited' };
  const userId = await createPerson(options, claims, email, now);
  if (userId === null) return { ok: false, reason: 'email-taken' };
  await ensureMembership(options, userId, role, now);
  return { ok: true, userId, role };
}

/**
 * Finds or creates the person, then decides their membership here, in the workspace the role
 * map is for: the default one.
 *
 * - **A new person** starts with the role a rule names, or `defaultRole`; with neither they are
 *   refused `not-invited` and no row is made. The default role is a new person's only, so a
 *   removal from this workspace is not undone at the person's next sign-in.
 * - **A person a rule names** gets the rule's role here on every sign-in: the role map is the
 *   identity provider's side of the decision, so a change there takes effect at the next one.
 * - **Anyone else keeps what they have**: their membership here, whatever an admin made it, or
 *   none — admitted while they are a member of any workspace, whose role is read there, and
 *   refused `not-invited` once they are a member of none.
 * - A disabled person is refused, and so is an email another person holds.
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
  if (existing === undefined) {
    return signInNewPerson(options, claims, email, mapped ?? policy.defaultRole, now);
  }
  const membership = await membershipOf(options, existing.id);
  const role: AccessRole | null = mapped ?? membership?.role ?? null;
  if (role === null && !(await memberElsewhere(options, existing.id))) {
    return { ok: false, reason: 'not-invited' };
  }
  if (!(await touchPerson(options, existing, claims, email, now, touch.afterMs ?? 0))) {
    return { ok: false, reason: 'email-taken' };
  }
  if (mapped !== null) await ensureMembership(options, existing.id, mapped, now, membership);
  return { ok: true, userId: existing.id, role };
}

/**
 * Whether the person is a member of any workspace but this one. Their account — whether they
 * are disabled, their email, name and external id, their sessions — is one row across the
 * installation, so a workspace that shares them with another does not decide it alone.
 */
export async function memberElsewhere(options: Options, userId: string): Promise<boolean> {
  const [row] = await options.db
    .select({ workspaceId: workspaceMembers.workspaceId })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.userId, userId),
        ne(workspaceMembers.workspaceId, options.workspaceId),
      ),
    )
    .limit(1);
  return row !== undefined;
}

/** Whether the person is an admin of this workspace, and not disabled. */
export async function isEnabledAdmin(options: Options, userId: string): Promise<boolean> {
  const [row] = await options.db
    .select({ id: users.id })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(
      and(
        eq(workspaceMembers.workspaceId, options.workspaceId),
        eq(workspaceMembers.userId, userId),
        eq(workspaceMembers.role, 'admin'),
        isNull(users.disabledAt),
      ),
    )
    .limit(1);
  return row !== undefined;
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
