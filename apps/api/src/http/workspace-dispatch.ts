import type { Context, Hono, MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import { TOKEN_PREFIX } from '../services/access-service.js';
import { bearerToken } from './bearer-token.js';
import { BROWSER_SIGN_IN } from './roles.js';

/**
 * Several workspaces in one install (ADR-014, team): which workspace a request belongs to, and
 * the dispatch that serves it from that workspace's own composition.
 *
 * **The workspace comes from a credential the server trusts**, in this order:
 *
 * 1. a live access token (`amt_…`): the token row's own workspace, whatever else the request
 *    says. An unknown or revoked one is no credential, and the rules below decide, as the
 *    caller resolver passes over it to the next credential;
 * 2. a runner's call about a job (`/api/v1/jobs/:jobId/…`, the id a uuid): the job's
 *    workspace, because runners are a pool the installation shares;
 * 3. an installation-wide credential — a bearer that is not an access token (the reporter
 *    secret, the runner registration secret, a runner's or a SCIM token) or the registration
 *    secret's own header: the default workspace. Each is checked by the route it opens and none
 *    belongs to a workspace, so nothing beside it can point it at another: `REPORTER_SECRET`
 *    uploads land in the default, a SCIM token is scoped by its own row, and a runner's
 *    registration, heartbeat and claim reach the shared pool there;
 * 4. a person — their session, or on team and enterprise the account Cloudflare Access signs in:
 *    the workspace they chose (the `automate_workspace` cookie) if they are a member of it, else
 *    the default if they are a member there, else their first;
 * 5. the installation's own admin (the installation session, an open install, or a Cloudflare
 *    identity the role map makes an admin and that is not an account): any workspace that
 *    exists, as chosen;
 * 6. everything else: the default workspace.
 *
 * A choice is a request to enter, never a grant: every credential is then checked again by the
 * workspace's own resolver, so a person who is not a member gets no role there.
 *
 * **Why a composition per workspace.** Every store and route group in the API is bound to a
 * workspace when it is built, and every cross-workspace isolation test reasons about exactly
 * that. Building the same composition once per workspace keeps that binding, rather than
 * threading a per-request value through every store and hoping no filter is missed.
 */
/**
 * The name of the cookie that remembers which workspace a person chose. Not a secret: it
 * holds a workspace id, and the dispatch checks it against a credential on every request.
 * Named without `cookie` because the secret-literal rule reads that word in a name as a
 * credential held in source (the same reason as `BROWSER_SIGN_IN`).
 */
export const WORKSPACE_CHOICE = 'automate_workspace';

/** A workspace id: what the create route accepts. `WORKSPACE_ID`, the default, may be any. */
export const WORKSPACE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/u;

/** A job id: a uuid in its canonical shape, in either case. Nothing else is a job. */
export const JOB_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export interface WorkspaceLookups {
  defaultWorkspace: string;
  /** The workspace of a live access token, or `null`. */
  tokenWorkspace: (token: string) => Promise<string | null>;
  /** The workspace of an execution job, or `null`. */
  jobWorkspace: (jobId: string) => Promise<string | null>;
  /** The person a request's session signs in, or `null`. */
  sessionUser: (context: Context) => Promise<string | null>;
  /** The workspaces a person is a member of, oldest membership first. */
  memberships: (userId: string) => Promise<string[]>;
  /** Whether the caller is the installation's own admin, who may enter any workspace. */
  installationLevel: (context: Context) => Promise<boolean>;
  workspaceExists: (workspaceId: string) => Promise<boolean>;
  /**
   * Whether a browser's token cookie counts, as `browserCredentialsCount` decides in
   * `http/roles.ts`: not under enforced single sign-on without break-glass. A cookie that signs
   * nobody in must not decide where they are sent either. Absent means it counts.
   */
  browserCredentials?: boolean;
}

const JOB_PATH = /^\/api\/v1\/jobs\/([^/]+)\//u;

/**
 * The header a runner may present the registration secret in, rather than as a bearer: the
 * one `registrationAuthorized` in `routes/execution/shared.ts` reads first.
 */
const REGISTRATION_HEADER = 'x-runner-registration-secret';

/**
 * The workspace a person chose, when the cookie holds a workspace id. A default `WORKSPACE_ID`
 * outside the pattern reads as no choice, which places the request in the default: the
 * workspace that was chosen.
 */
function chosen(context: Context): string | null {
  const value = getCookie(context, WORKSPACE_CHOICE);
  return value !== undefined && WORKSPACE_ID_PATTERN.test(value) ? value : null;
}

/**
 * The job a call is about: the id in its path, when that is a job id. Read as it arrives and
 * never decoded — a uuid has nothing to decode, and decoding `%ZZ` throws before any credential
 * has been asked for.
 */
function jobOf(path: string): string | undefined {
  const id = JOB_PATH.exec(path)?.[1];
  return id !== undefined && JOB_ID_PATTERN.test(id) ? id : undefined;
}

/** Rule 3: a credential that belongs to the installation rather than to any workspace. */
function installationWide(context: Context, bearer: string | undefined): boolean {
  return (
    (bearer !== undefined && !bearer.startsWith(TOKEN_PREFIX)) ||
    context.req.header(REGISTRATION_HEADER) !== undefined
  );
}

/** Rules 1 to 3: the workspace a credential decides by itself, or `null` when none does. */
async function credentialWorkspace(
  context: Context,
  lookups: WorkspaceLookups,
): Promise<string | null> {
  const bearer = bearerToken(context.req.header('authorization'));
  const cookie =
    lookups.browserCredentials === false ? undefined : getCookie(context, BROWSER_SIGN_IN);
  const presented = bearer ?? cookie;
  if (presented?.startsWith(TOKEN_PREFIX) === true) {
    const own = await lookups.tokenWorkspace(presented);
    if (own !== null) return own;
  }
  const job = jobOf(context.req.path);
  if (job !== undefined && presented !== undefined) {
    return (await lookups.jobWorkspace(job)) ?? lookups.defaultWorkspace;
  }
  return installationWide(context, bearer) ? lookups.defaultWorkspace : null;
}

/** Rule 4, over a person's memberships. */
function personWorkspace(member: string[], choice: string | null, fallback: string): string {
  if (choice !== null && member.includes(choice)) return choice;
  if (member.includes(fallback) || member.length === 0) return fallback;
  return member[0] ?? fallback;
}

export async function resolveRequestWorkspace(
  context: Context,
  lookups: WorkspaceLookups,
): Promise<string> {
  const decided = await credentialWorkspace(context, lookups);
  if (decided !== null) return decided;
  const choice = chosen(context);
  const userId = await lookups.sessionUser(context);
  if (userId !== null) {
    return personWorkspace(await lookups.memberships(userId), choice, lookups.defaultWorkspace);
  }
  if (
    choice !== null &&
    (await lookups.installationLevel(context)) &&
    (await lookups.workspaceExists(choice))
  ) {
    return choice;
  }
  return lookups.defaultWorkspace;
}

export interface WorkspaceDispatchOptions {
  lookups: WorkspaceLookups;
  /** Builds a workspace's composition. Called once per workspace, never for the default. */
  compose: (workspaceId: string) => Hono;
}

/**
 * Serves a request from its workspace's composition. The default workspace is served in place
 * by the routes registered after this middleware; any other is forwarded, whole, to a
 * composition built the first time that workspace is asked for and kept.
 */
export function createWorkspaceDispatch(options: WorkspaceDispatchOptions): MiddlewareHandler {
  const compositions = new Map<string, Hono>();
  return async (context, next) => {
    const workspaceId = await resolveRequestWorkspace(context, options.lookups);
    if (workspaceId === options.lookups.defaultWorkspace) {
      await next();
      return;
    }
    let composition = compositions.get(workspaceId);
    if (composition === undefined) {
      composition = options.compose(workspaceId);
      compositions.set(workspaceId, composition);
    }
    return composition.fetch(context.req.raw, context.env as never);
  };
}
