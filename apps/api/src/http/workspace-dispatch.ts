import type { Context, Hono, MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import { bearerToken } from './bearer-token.js';
import { BROWSER_SIGN_IN } from './roles.js';

/**
 * Several workspaces in one install (ADR-014, team): which workspace a request belongs to, and
 * the dispatch that serves it from that workspace's own composition.
 *
 * **The workspace comes from a credential the server trusts**, in this order:
 *
 * 1. an access token (`amt_…`): the token row's own workspace, whatever else the request says;
 * 2. a runner's call about a job (`/api/v1/jobs/:jobId/…`): the job's workspace, because
 *    runners are a pool the installation shares;
 * 3. a person — their session, or on team and enterprise the account Cloudflare Access signs in:
 *    the workspace they chose (the `automate_workspace` cookie) if they are a member of it, else
 *    the default if they are a member there, else their first;
 * 4. the installation's own admin (the installation session, an open install, or a Cloudflare
 *    identity the role map makes an admin and that is not an account): any workspace that
 *    exists, as chosen;
 * 5. everything else: the default workspace.
 *
 * A choice is a request to enter, never a grant: every credential is then checked again by the
 * workspace's own resolver, so a person who is not a member gets no role there.
 *
 * **Why a composition per workspace.** Every store and route group in the API is bound to a
 * workspace when it is built, and every cross-workspace isolation test reasons about exactly
 * that. Building the same composition once per workspace keeps that binding, rather than
 * threading a per-request value through every store and hoping no filter is missed.
 */
export const WORKSPACE_COOKIE = 'automate_workspace';

/** A workspace id: what `WORKSPACE_ID` and the create route accept. */
export const WORKSPACE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/u;

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
}

const JOB_PATH = /^\/api\/v1\/jobs\/([^/]+)\//u;

function chosen(context: Context): string | null {
  const value = getCookie(context, WORKSPACE_COOKIE);
  return value !== undefined && WORKSPACE_ID_PATTERN.test(value) ? value : null;
}

export async function resolveRequestWorkspace(
  context: Context,
  lookups: WorkspaceLookups,
): Promise<string> {
  const presented =
    bearerToken(context.req.header('authorization')) ?? getCookie(context, BROWSER_SIGN_IN);
  if (presented?.startsWith('amt_') === true) {
    return (await lookups.tokenWorkspace(presented)) ?? lookups.defaultWorkspace;
  }
  const job = JOB_PATH.exec(context.req.path)?.[1];
  if (job !== undefined && presented !== undefined) {
    return (await lookups.jobWorkspace(decodeURIComponent(job))) ?? lookups.defaultWorkspace;
  }
  const choice = chosen(context);
  const userId = await lookups.sessionUser(context);
  if (userId !== null) {
    const member = await lookups.memberships(userId);
    if (choice !== null && member.includes(choice)) return choice;
    if (member.includes(lookups.defaultWorkspace) || member.length === 0) {
      return lookups.defaultWorkspace;
    }
    return member[0] ?? lookups.defaultWorkspace;
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
