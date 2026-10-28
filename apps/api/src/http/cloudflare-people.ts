import type { Context } from 'hono';
import type { CloudflareAccessConfig } from '@automate/config';
import { perRequest } from './per-request.js';
import type { Caller } from '../services/access-service.js';
import type { ProjectRegistryServiceOptions } from '../services/project-registry-service.js';
import { callerForUser, signInPerson } from '../services/user-service.js';
import {
  cloudflareActor,
  isPerson,
  roleMapCaller,
  verifiedIdentity,
  type AccessLog,
  type CloudflareAccessVerifier,
  type CloudflareIdentity,
} from './cloudflare-access.js';

/**
 * The people Cloudflare Access lets in, as accounts (ADR-014, team and enterprise).
 *
 * On `startup` an Access identity is read through the role map and nothing else: that profile
 * has no accounts. From `team`, a person is a `users` row and their role is a membership, so
 * what an admin, SCIM or the role map decides about them reaches them. That matters because
 * Cloudflare Access is how this product does SAML. Before this, a person SCIM deactivated kept
 * the role map's role until their Access session expired, could not be given a role in any
 * workspace but the default, and never appeared on the Members page.
 *
 * - **The identity is the Access team and its user id** (`iss`, `sub`), never the email: the
 *   rule an OIDC sign-in follows. A person SCIM provisioned is linked by email on their first
 *   request, and only while their row names no identity yet.
 * - **The role map decides the default workspace**, as OIDC's does: a person a rule names gets
 *   its role there on every request; anyone else gets `CF_ACCESS_DEFAULT_ROLE` when their first
 *   request makes their account, and whatever an admin gives them after — no role there, once
 *   removed, which the default role does not undo. A person with no role in the default
 *   workspace is let in while they are a member of another. Every other workspace is
 *   membership only.
 * - **Every request is a sign-in**, because Access has no sign-in event. So a disabled person
 *   is refused on their next request, which is what makes SCIM deactivation immediate. An
 *   unchanged person's row is rewritten at most every few minutes, not on every request.
 * - **Once per request.** The dispatch asks which person this is to choose the workspace, and
 *   that workspace's resolver asks again for the role; the answer is kept on the request.
 * - **A machine is not a person.** A service token keeps the role map's role, everywhere.
 */
export interface CloudflarePeopleOptions extends Pick<ProjectRegistryServiceOptions, 'db'> {
  /** The workspace whose membership the role map decides. */
  defaultWorkspace: string;
  verifier: CloudflareAccessVerifier;
  access: CloudflareAccessConfig;
  /** How long an unchanged person's row goes unwritten. */
  touchAfterMs?: number;
  now?: () => Date;
  log?: AccessLog;
}

export interface CloudflarePeople {
  /** The account this request's Access identity signs in, or `null`. */
  userId: (context: Context) => Promise<string | null>;
  /** The remote caller source for one workspace's resolver. */
  callerIn: (workspaceId: string) => (context: Context) => Promise<Caller | null>;
}

interface Seen {
  identity: CloudflareIdentity;
  /** The account, or `null` for a machine or for a person this install does not admit. */
  userId: string | null;
}

export const CLOUDFLARE_TOUCH_AFTER_MS = 5 * 60_000;

export function createCloudflarePeople(options: CloudflarePeopleOptions): CloudflarePeople {
  const issuer = `https://${options.access.teamDomain}`;
  const now = options.now ?? (() => new Date());

  /** The account, provisioned on first sight; `null` for a machine or a refusal. */
  const signIn = async (identity: CloudflareIdentity): Promise<string | null> => {
    if (!isPerson(identity)) return null;
    const outcome = await signInPerson(
      { db: options.db, workspaceId: options.defaultWorkspace },
      {
        issuer,
        subject: identity.subject,
        email: identity.email ?? '',
        name: null,
        groups: identity.groups,
      },
      { roleMap: options.access.roleMap, defaultRole: options.access.defaultRole },
      now(),
      { afterMs: options.touchAfterMs ?? CLOUDFLARE_TOUCH_AFTER_MS },
    );
    return outcome.ok ? outcome.userId : null;
  };

  const read = perRequest(async (context): Promise<Seen | null> => {
    const identity = await verifiedIdentity(options.verifier, context, options.log);
    return identity === null ? null : { identity, userId: await signIn(identity) };
  });

  return {
    userId: async (context) => (await read(context))?.userId ?? null,
    callerIn: (workspaceId) => async (context) => {
      const seen = await read(context);
      if (seen === null) return null;
      if (!isPerson(seen.identity)) return roleMapCaller(seen.identity, options.access);
      // Known to Access and refused here: disabled, not invited, or an email another identity
      // holds. Forbidden rather than anonymous, so nobody is asked to sign in again.
      const refused: Caller = {
        actor: cloudflareActor(seen.identity),
        role: null,
        uploaderFor: null,
      };
      if (seen.userId === null) return refused;
      return (await callerForUser({ db: options.db, workspaceId }, seen.userId)) ?? refused;
    },
  };
}
