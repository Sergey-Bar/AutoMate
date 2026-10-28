import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod/v4';
import type { Profile } from '@automate/config';
import { accessTokens, workspaceMembers, workspaces } from '@automate/db';
import { DomainError, ErrorCode } from '../errors/domain-error.js';
import { guard } from '../http/access.js';
import { bearerToken } from '../http/bearer-token.js';
import { BROWSER_SIGN_IN, isInstallationAdmin } from '../http/roles.js';
import { WORKSPACE_CHOICE, WORKSPACE_ID_PATTERN } from '../http/workspace-dispatch.js';
import { isSecureFor, type SecureCookies } from '../http/secure-cookies.js';
import { audit, hashToken, type Caller, type Role } from '../services/access-service.js';
import type { ProjectRegistryServiceOptions } from '../services/project-registry-service.js';

/**
 * Workspaces (ADR-014, team): which ones a caller may enter, choosing one, and creating one.
 * Served before the workspace dispatch, because they are about which workspace to be in.
 *
 * - `GET /api/v1/workspaces` — the workspaces this caller may enter, with their role in each,
 *   and the one this request is in. The installation's own admin may enter every one; a person
 *   the ones they are a member of; a token only its own.
 * - `POST /api/v1/workspaces/select` — remembers a choice in an `httpOnly` cookie. A choice
 *   is only ever a request to enter: the dispatch checks the credential again on every request.
 * - `POST /api/v1/workspaces` — creates one, on `team` and `enterprise`. The installation's
 *   admin, or an admin of the default workspace, may; a person who creates one is its admin.
 */
export interface WorkspacesRouteOptions extends Pick<ProjectRegistryServiceOptions, 'db'> {
  defaultWorkspace: string;
  profile: Profile;
  secureCookies: SecureCookies;
  /** The caller as the default workspace's resolver reads them. */
  defaultCaller: (context: Context) => Promise<Caller>;
  /** The person a request's session signs in, or `null`. */
  sessionUser: (context: Context) => Promise<string | null>;
  /** The workspace this request is in, as the dispatch resolved it. */
  current: (context: Context) => Promise<string>;
}

interface Entry {
  id: string;
  name: string;
  role: Role;
}

const CreateSchema = z.object({
  id: z.string().regex(WORKSPACE_ID_PATTERN, 'lowercase letters, digits and hyphens'),
  name: z.string().trim().min(1).max(100),
});
const SelectSchema = z.object({ workspaceId: z.string().regex(WORKSPACE_ID_PATTERN) });

function invalid(context: Context, message: string, details: unknown) {
  return context.json({ error: { code: ErrorCode.INVALID_REQUEST_BODY, message, details } }, 400);
}

export function createWorkspacesRoutes(options: WorkspacesRouteOptions): Hono {
  const app = new Hono();

  /** Every workspace this caller may enter, with their role there, oldest first. */
  const accessible = async (context: Context): Promise<{ entries: Entry[]; byToken: boolean }> => {
    const presented =
      bearerToken(context.req.header('authorization')) ?? getCookie(context, BROWSER_SIGN_IN);
    if (presented?.startsWith('amt_') === true) {
      const rows = await options.db
        .select({ id: workspaces.id, name: workspaces.name, role: accessTokens.role })
        .from(accessTokens)
        .innerJoin(workspaces, eq(workspaces.id, accessTokens.workspaceId))
        .where(
          and(eq(accessTokens.tokenHash, hashToken(presented)), isNull(accessTokens.revokedAt)),
        )
        .limit(1);
      return {
        byToken: true,
        entries: rows
          .filter((row) => row.role !== 'uploader')
          .map((row) => ({ id: row.id, name: row.name, role: row.role as Role })),
      };
    }
    const userId = await options.sessionUser(context);
    if (userId !== null) {
      const rows = await options.db
        .select({ id: workspaces.id, name: workspaces.name, role: workspaceMembers.role })
        .from(workspaceMembers)
        .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
        .where(eq(workspaceMembers.userId, userId))
        .orderBy(asc(workspaces.createdAt));
      return { byToken: false, entries: rows.map((row) => ({ ...row, role: row.role as Role })) };
    }
    if (isInstallationAdmin(await options.defaultCaller(context))) {
      const rows = await options.db
        .select({ id: workspaces.id, name: workspaces.name })
        .from(workspaces)
        .orderBy(asc(workspaces.createdAt));
      return { byToken: false, entries: rows.map((row) => ({ ...row, role: 'admin' as const })) };
    }
    return { byToken: false, entries: [] };
  };

  /** A caller who may enter at least one workspace. Tagged viewer: the least role anywhere. */
  const anyone: MiddlewareHandler = guard('viewer', async (context, next) => {
    if ((await accessible(context)).entries.length === 0) {
      throw new DomainError(ErrorCode.UNAUTHENTICATED, 'Sign in, or send an access token');
    }
    await next();
  });

  /** The installation's admin, or an admin of the default workspace. */
  const installationAdmin: MiddlewareHandler = guard('admin', async (context, next) => {
    const caller = await options.defaultCaller(context);
    const userId = await options.sessionUser(context);
    const defaultAdmin =
      userId !== null &&
      (await accessible(context)).entries.some(
        (entry) => entry.id === options.defaultWorkspace && entry.role === 'admin',
      );
    if (!isInstallationAdmin(caller) && !defaultAdmin) {
      if (caller.role === null && userId === null) {
        throw new DomainError(ErrorCode.UNAUTHENTICATED, 'Sign in, or send an access token');
      }
      throw new DomainError(
        ErrorCode.FORBIDDEN,
        'Creating a workspace needs an admin of the install',
      );
    }
    await next();
  });

  app.get('/api/v1/workspaces', anyone, async (context) =>
    context.json({
      current: await options.current(context),
      workspaces: (await accessible(context)).entries,
    }),
  );

  app.post('/api/v1/workspaces/select', anyone, async (context) => {
    const parsed = SelectSchema.safeParse(await context.req.json().catch(() => null));
    if (!parsed.success) return invalid(context, 'Name a workspace', parsed.error.issues);
    const { entries, byToken } = await accessible(context);
    if (byToken) {
      throw new DomainError(ErrorCode.FORBIDDEN, 'An access token belongs to one workspace');
    }
    if (!entries.some((entry) => entry.id === parsed.data.workspaceId)) {
      throw new DomainError(ErrorCode.FORBIDDEN, 'You are not a member of that workspace');
    }
    setCookie(context, WORKSPACE_CHOICE, parsed.data.workspaceId, {
      httpOnly: true,
      sameSite: 'Lax',
      secure: isSecureFor(options.secureCookies, context),
      path: '/',
      maxAge: 400 * 24 * 3600,
    });
    return context.json({ current: parsed.data.workspaceId });
  });

  app.post('/api/v1/workspaces', installationAdmin, async (context) => {
    if (options.profile !== 'team' && options.profile !== 'enterprise') {
      throw new DomainError(
        'WORKSPACES_NEED_TEAM',
        'Several workspaces need AUTOMATE_PROFILE=team or enterprise',
      );
    }
    const parsed = CreateSchema.safeParse(await context.req.json().catch(() => null));
    if (!parsed.success) return invalid(context, 'Invalid workspace', parsed.error.issues);
    const created = await options.db
      .insert(workspaces)
      .values({
        id: parsed.data.id,
        name: parsed.data.name,
        configPath: '.',
        createdAt: new Date(),
      })
      .onConflictDoNothing()
      .returning({ id: workspaces.id });
    if (created.length === 0) {
      throw new DomainError(ErrorCode.CONFLICT, 'A workspace with that id already exists');
    }
    const userId = await options.sessionUser(context);
    const caller = await options.defaultCaller(context);
    const actor = userId === null ? caller.actor : `user:${userId}`;
    if (userId !== null) {
      await options.db
        .insert(workspaceMembers)
        .values({ workspaceId: parsed.data.id, userId, role: 'admin', invitedBy: actor });
    }
    for (const workspaceId of [parsed.data.id, options.defaultWorkspace]) {
      await audit(
        { db: options.db, workspaceId },
        {
          actor,
          action: 'workspace.create',
          resourceType: 'workspace',
          resourceId: parsed.data.id,
          details: { name: parsed.data.name },
        },
      );
    }
    return context.json({ id: parsed.data.id, name: parsed.data.name }, 201);
  });

  return app;
}
