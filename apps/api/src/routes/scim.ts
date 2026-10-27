import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { and, asc, eq, isNull, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod/v4';
import type { AccessRole } from '@automate/config';
import { DrizzleSessionStore, scimTokens, users, workspaceMembers } from '@automate/db';
import { DomainError, ErrorCode } from '../errors/domain-error.js';
import { guard } from '../http/access.js';
import { bearerToken } from '../http/bearer-token.js';
import { callerOf, requireRole, type CallerResolver } from '../http/roles.js';
import { audit } from '../services/access-service.js';
import type { ProjectRegistryServiceOptions } from '../services/project-registry-service.js';

/**
 * SCIM 2.0 provisioning (RFC 7643/7644; ADR-014, enterprise): an identity provider creates
 * people, sets their role, and deactivates them, and a deactivated person is signed out at once.
 *
 * - **The credential is a SCIM token** (`scim_…`), issued by an admin at
 *   `POST /api/v1/scim-tokens`, shown once and stored as a sha256. Every SCIM request is scoped
 *   to the workspace of the token that made it, never to anything the request names.
 * - **Users** are the people with a role in that workspace. `userName` is the email.
 * - **Groups are the three roles**, `automate-viewer`, `automate-operator` and `automate-admin`
 *   (ids `viewer`, `operator`, `admin`). Adding a person to one gives them that role; removing
 *   them returns them to the default role. Assign the groups in the identity provider's app.
 *
 * A provisioned person has no issuer or subject until their first single sign-on, which links
 * the row by email (`signInPerson`). Disabling a person is installation-wide.
 */
export interface ScimRouteOptions extends Pick<
  ProjectRegistryServiceOptions,
  'db' | 'workspaceId'
> {
  access: CallerResolver;
  /** The role a provisioned person starts with, and returns to when removed from a group. */
  defaultRole?: AccessRole;
}

const SCIM = 'application/scim+json';
const USER = 'urn:ietf:params:scim:schemas:core:2.0:User';
const GROUP = 'urn:ietf:params:scim:schemas:core:2.0:Group';
const LIST = 'urn:ietf:params:scim:api:messages:2.0:ListResponse';
const ERROR = 'urn:ietf:params:scim:api:messages:2.0:Error';
const ROLES = ['viewer', 'operator', 'admin'] as const;
export const SCIM_TOKEN_PREFIX = 'scim_';

const sha = (value: string): string => createHash('sha256').update(value).digest('hex');

type Options = Pick<ScimRouteOptions, 'db' | 'workspaceId'>;

/** Issues a SCIM token for the workspace. The secret is returned once. */
export async function createScimToken(
  options: Options,
  name: string,
  createdBy: string,
): Promise<{ token: string; summary: { id: string; name: string; displayPrefix: string } }> {
  const token = `${SCIM_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
  const displayPrefix = token.slice(0, 12);
  const [row] = await options.db
    .insert(scimTokens)
    .values({
      workspaceId: options.workspaceId,
      name,
      tokenHash: sha(token),
      displayPrefix,
      createdBy,
    })
    .returning({ id: scimTokens.id });
  return { token, summary: { id: String(row?.id), name, displayPrefix } };
}

interface ScimScope {
  tokenId: string;
  workspaceId: string;
}
const scopes = new WeakMap<Request, ScimScope>();

function scimError(context: Context, status: number, detail: string, scimType?: string) {
  return context.body(
    JSON.stringify({
      schemas: [ERROR],
      status: String(status),
      ...(scimType ? { scimType } : {}),
      detail,
    }),
    status as 400,
    { 'content-type': SCIM },
  );
}

function scimJson(context: Context, body: unknown, status = 200) {
  return context.body(JSON.stringify(body), status as 200, { 'content-type': SCIM });
}

/** The SCIM token guard: a live token's workspace, or a SCIM 401. */
function requireScimToken(options: Options): MiddlewareHandler {
  return guard('scim-token', async (context, next) => {
    const presented = bearerToken(context.req.header('authorization')) ?? '';
    if (!presented.startsWith(SCIM_TOKEN_PREFIX)) {
      return scimError(context, 401, 'A SCIM token is required');
    }
    const hash = sha(presented);
    const [row] = await options.db
      .select({
        id: scimTokens.id,
        workspaceId: scimTokens.workspaceId,
        tokenHash: scimTokens.tokenHash,
      })
      .from(scimTokens)
      .where(and(eq(scimTokens.tokenHash, hash), isNull(scimTokens.revokedAt)))
      .limit(1);
    if (row === undefined || !timingSafeEqual(Buffer.from(row.tokenHash), Buffer.from(hash))) {
      return scimError(context, 401, 'The SCIM token is not valid');
    }
    await options.db
      .update(scimTokens)
      .set({ lastUsedAt: new Date() })
      .where(eq(scimTokens.id, row.id));
    scopes.set(context.req.raw, { tokenId: row.id, workspaceId: row.workspaceId });
    await next();
  });
}

function scopeOf(context: Context): ScimScope {
  const scope = scopes.get(context.req.raw);
  if (scope === undefined) throw new DomainError(ErrorCode.UNAUTHENTICATED, 'No SCIM token');
  return scope;
}

/** `true`, `"True"`, `false`, `"False"`: Entra sends booleans as strings. */
function booleanOf(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string' && /^(true|false)$/iu.test(value))
    return value.toLowerCase() === 'true';
  return undefined;
}

const UserBodySchema = z.object({
  userName: z.string().trim().min(3).max(320),
  externalId: z.string().max(200).optional(),
  displayName: z.string().max(200).optional(),
  name: z
    .object({ givenName: z.string().optional(), familyName: z.string().optional() })
    .optional(),
  emails: z.array(z.object({ value: z.string(), primary: z.boolean().optional() })).optional(),
  active: z.unknown().optional(),
});

const PatchSchema = z.object({
  Operations: z
    .array(
      z.object({
        op: z.string(),
        path: z.string().optional(),
        value: z.unknown().optional(),
      }),
    )
    .min(1),
});

type Row = {
  id: string;
  email: string;
  displayName: string;
  externalId: string | null;
  disabledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  role: string;
};

function emailOf(body: z.infer<typeof UserBodySchema>): string {
  const primary = body.emails?.find((entry) => entry.primary) ?? body.emails?.[0];
  return (primary?.value ?? body.userName).trim().toLowerCase();
}

function displayNameOf(body: z.infer<typeof UserBodySchema>, email: string): string {
  const given = body.name?.givenName?.trim() ?? '';
  const family = body.name?.familyName?.trim() ?? '';
  return body.displayName?.trim() || `${given} ${family}`.trim() || email;
}

function userResource(row: Row, base: string) {
  return {
    schemas: [USER],
    id: row.id,
    ...(row.externalId === null ? {} : { externalId: row.externalId }),
    userName: row.email,
    displayName: row.displayName,
    emails: [{ value: row.email, primary: true }],
    active: row.disabledAt === null,
    groups: [{ value: row.role, display: `automate-${row.role}` }],
    meta: {
      resourceType: 'User',
      created: row.createdAt.toISOString(),
      lastModified: row.updatedAt.toISOString(),
      location: `${base}/scim/v2/Users/${row.id}`,
    },
  };
}

/** `attr eq "value"` for the three attributes providers filter users on. */
function filterOf(filter: string | undefined): SQL | null | undefined {
  if (filter === undefined || filter.trim() === '') return undefined;
  const match = /^\s*(userName|externalId|emails\.value|emails)\s+eq\s+"([^"]*)"\s*$/iu.exec(
    filter,
  );
  if (match === null) return null;
  const attribute = (match[1] ?? '').toLowerCase();
  const value = match[2] ?? '';
  return attribute === 'externalid'
    ? eq(users.externalId, value)
    : eq(users.email, value.toLowerCase());
}

export function createScimRoutes(options: ScimRouteOptions): Hono {
  const app = new Hono();
  const scim = requireScimToken(options);
  const admin = requireRole('admin', options.access);
  const sessions = new DrizzleSessionStore(options.db as never);
  const defaultRole: AccessRole = options.defaultRole ?? 'viewer';
  const base = (context: Context) => new URL(context.req.url).origin;

  const select = (workspaceId: string, where?: SQL) =>
    options.db
      .select({
        id: users.id,
        email: users.email,
        displayName: users.displayName,
        externalId: users.externalId,
        disabledAt: users.disabledAt,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
        role: workspaceMembers.role,
      })
      .from(workspaceMembers)
      .innerJoin(users, eq(users.id, workspaceMembers.userId))
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), ...(where ? [where] : [])))
      .orderBy(asc(users.email));

  const one = async (workspaceId: string, id: string): Promise<Row | undefined> => {
    if (!z.string().uuid().safeParse(id).success) return undefined;
    return (await select(workspaceId, eq(users.id, id)).limit(1))[0];
  };

  const record = (scope: ScimScope, action: string, userId: string, details = {}) =>
    audit(
      { db: options.db, workspaceId: scope.workspaceId },
      { actor: `scim:${scope.tokenId}`, action, resourceType: 'user', resourceId: userId, details },
    );

  const setActive = async (scope: ScimScope, userId: string, active: boolean) => {
    const now = new Date();
    await options.db
      .update(users)
      .set({ disabledAt: active ? null : now, updatedAt: now })
      .where(eq(users.id, userId));
    if (!active) await sessions.revokeForUser(userId, now);
    await record(scope, active ? 'scim.user.activate' : 'scim.user.deactivate', userId);
  };

  const setRole = async (scope: ScimScope, userId: string, role: AccessRole) => {
    await options.db
      .update(workspaceMembers)
      .set({ role })
      .where(
        and(
          eq(workspaceMembers.workspaceId, scope.workspaceId),
          eq(workspaceMembers.userId, userId),
        ),
      );
    await record(scope, 'scim.user.role', userId, { role });
  };

  app.get('/scim/v2/ServiceProviderConfig', scim, (context) =>
    scimJson(context, {
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'],
      patch: { supported: true },
      bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
      filter: { supported: true, maxResults: 200 },
      changePassword: { supported: false },
      sort: { supported: false },
      etag: { supported: false },
      authenticationSchemes: [
        {
          type: 'oauthbearertoken',
          name: 'SCIM token',
          description: 'A scim_ token from the Access page',
        },
      ],
    }),
  );

  app.get('/scim/v2/Users', scim, async (context) => {
    const scope = scopeOf(context);
    const filter = filterOf(context.req.query('filter'));
    if (filter === null) {
      return scimError(
        context,
        400,
        'Only userName, externalId and emails eq filters are supported',
        'invalidFilter',
      );
    }
    const startIndex = Math.max(1, Number(context.req.query('startIndex') ?? 1) || 1);
    const count = Math.min(200, Math.max(0, Number(context.req.query('count') ?? 100) || 100));
    const rows = await select(scope.workspaceId, filter);
    const page = rows.slice(startIndex - 1, startIndex - 1 + count);
    return scimJson(context, {
      schemas: [LIST],
      totalResults: rows.length,
      startIndex,
      itemsPerPage: page.length,
      Resources: page.map((row) => userResource(row, base(context))),
    });
  });

  app.post('/scim/v2/Users', scim, async (context) => {
    const scope = scopeOf(context);
    const parsed = UserBodySchema.safeParse(await context.req.json().catch(() => null));
    if (!parsed.success) return scimError(context, 400, 'The user is not valid', 'invalidValue');
    const email = emailOf(parsed.data);
    const now = new Date();
    const active = booleanOf(parsed.data.active) ?? true;
    const [existing] = await options.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    let userId = existing?.id;
    if (userId !== undefined && (await one(scope.workspaceId, userId)) !== undefined) {
      return scimError(context, 409, 'A user with this userName already exists', 'uniqueness');
    }
    if (userId === undefined) {
      const [created] = await options.db
        .insert(users)
        .values({
          email,
          displayName: displayNameOf(parsed.data, email),
          externalId: parsed.data.externalId ?? null,
          disabledAt: active ? null : now,
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: users.id });
      userId = String(created?.id);
    }
    await options.db.insert(workspaceMembers).values({
      workspaceId: scope.workspaceId,
      userId,
      role: defaultRole,
      invitedBy: `scim:${scope.tokenId}`,
    });
    await record(scope, 'scim.user.create', userId, { role: defaultRole });
    const row = await one(scope.workspaceId, userId);
    return scimJson(context, userResource(row as Row, base(context)), 201);
  });

  app.get('/scim/v2/Users/:id', scim, async (context) => {
    const row = await one(scopeOf(context).workspaceId, context.req.param('id'));
    return row === undefined
      ? scimError(context, 404, 'No such user')
      : scimJson(context, userResource(row, base(context)));
  });

  app.put('/scim/v2/Users/:id', scim, async (context) => {
    const scope = scopeOf(context);
    const row = await one(scope.workspaceId, context.req.param('id'));
    if (row === undefined) return scimError(context, 404, 'No such user');
    const parsed = UserBodySchema.safeParse(await context.req.json().catch(() => null));
    if (!parsed.success) return scimError(context, 400, 'The user is not valid', 'invalidValue');
    const email = emailOf(parsed.data);
    await options.db
      .update(users)
      .set({
        email,
        displayName: displayNameOf(parsed.data, email),
        externalId: parsed.data.externalId ?? row.externalId,
        updatedAt: new Date(),
      })
      .where(eq(users.id, row.id));
    const active = booleanOf(parsed.data.active);
    if (active !== undefined && active !== (row.disabledAt === null))
      await setActive(scope, row.id, active);
    return scimJson(
      context,
      userResource((await one(scope.workspaceId, row.id)) as Row, base(context)),
    );
  });

  app.patch('/scim/v2/Users/:id', scim, async (context) => {
    const scope = scopeOf(context);
    const row = await one(scope.workspaceId, context.req.param('id'));
    if (row === undefined) return scimError(context, 404, 'No such user');
    const parsed = PatchSchema.safeParse(await context.req.json().catch(() => null));
    if (!parsed.success) return scimError(context, 400, 'The patch is not valid', 'invalidSyntax');
    for (const operation of parsed.data.Operations) {
      if (!/^(replace|add)$/iu.test(operation.op)) continue;
      const fields: Record<string, unknown> =
        operation.path === undefined
          ? typeof operation.value === 'object' && operation.value !== null
            ? (operation.value as Record<string, unknown>)
            : {}
          : { [operation.path]: operation.value };
      for (const [path, value] of Object.entries(fields)) {
        if (path.toLowerCase() === 'active') {
          const active = booleanOf(value);
          if (active !== undefined) await setActive(scope, row.id, active);
        } else if (path === 'displayName' && typeof value === 'string') {
          await options.db
            .update(users)
            .set({ displayName: value, updatedAt: new Date() })
            .where(eq(users.id, row.id));
        } else if (path === 'externalId' && typeof value === 'string') {
          await options.db
            .update(users)
            .set({ externalId: value, updatedAt: new Date() })
            .where(eq(users.id, row.id));
        }
      }
    }
    return scimJson(
      context,
      userResource((await one(scope.workspaceId, row.id)) as Row, base(context)),
    );
  });

  app.delete('/scim/v2/Users/:id', scim, async (context) => {
    const scope = scopeOf(context);
    const row = await one(scope.workspaceId, context.req.param('id'));
    if (row === undefined) return scimError(context, 404, 'No such user');
    await options.db
      .delete(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, scope.workspaceId),
          eq(workspaceMembers.userId, row.id),
        ),
      );
    const [elsewhere] = await options.db
      .select({ n: sql<number>`count(*)::int` })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.userId, row.id));
    const now = new Date();
    // A person with no role anywhere is disabled, so a later sign-in cannot recreate them.
    if ((elsewhere?.n ?? 0) === 0) {
      await options.db
        .update(users)
        .set({ disabledAt: now, updatedAt: now })
        .where(eq(users.id, row.id));
    }
    await sessions.revokeForUser(row.id, now);
    await record(scope, 'scim.user.delete', row.id);
    return context.body(null, 204);
  });

  const groupResource = async (workspaceId: string, role: AccessRole, context: Context) => {
    const members = await select(workspaceId, eq(workspaceMembers.role, role));
    return {
      schemas: [GROUP],
      id: role,
      displayName: `automate-${role}`,
      members: members.map((member) => ({ value: member.id, display: member.email })),
      meta: { resourceType: 'Group', location: `${base(context)}/scim/v2/Groups/${role}` },
    };
  };

  app.get('/scim/v2/Groups', scim, async (context) => {
    const scope = scopeOf(context);
    const resources = await Promise.all(
      ROLES.map((role) => groupResource(scope.workspaceId, role, context)),
    );
    return scimJson(context, {
      schemas: [LIST],
      totalResults: resources.length,
      startIndex: 1,
      itemsPerPage: resources.length,
      Resources: resources,
    });
  });

  app.get('/scim/v2/Groups/:id', scim, async (context) => {
    const role = ROLES.find((candidate) => candidate === context.req.param('id'));
    if (role === undefined) return scimError(context, 404, 'No such group');
    return scimJson(context, await groupResource(scopeOf(context).workspaceId, role, context));
  });

  app.patch('/scim/v2/Groups/:id', scim, async (context) => {
    const scope = scopeOf(context);
    const role = ROLES.find((candidate) => candidate === context.req.param('id'));
    if (role === undefined) return scimError(context, 404, 'No such group');
    const parsed = PatchSchema.safeParse(await context.req.json().catch(() => null));
    if (!parsed.success) return scimError(context, 400, 'The patch is not valid', 'invalidSyntax');
    const idsIn = (value: unknown): string[] =>
      (Array.isArray(value) ? value : [])
        .map((entry: unknown) => (entry as { value?: unknown } | null)?.value)
        .filter((id): id is string => typeof id === 'string');
    for (const operation of parsed.data.Operations) {
      const op = operation.op.toLowerCase();
      const inPath = /^members\[value eq "([^"]+)"\]$/iu.exec(operation.path ?? '')?.[1];
      const ids = inPath === undefined ? idsIn(operation.value) : [inPath];
      if (op === 'add' || op === 'replace') {
        if (op === 'replace') {
          const current = await select(scope.workspaceId, eq(workspaceMembers.role, role));
          for (const member of current.filter((entry) => !ids.includes(entry.id))) {
            await setRole(scope, member.id, defaultRole);
          }
        }
        for (const id of ids) {
          if ((await one(scope.workspaceId, id)) !== undefined) await setRole(scope, id, role);
        }
      } else if (op === 'remove') {
        for (const id of ids) {
          const member = await one(scope.workspaceId, id);
          if (member?.role === role) await setRole(scope, id, defaultRole);
        }
      }
    }
    return context.body(null, 204);
  });

  // The admin side: SCIM tokens for this workspace, issued, listed and revoked.
  app.get('/api/v1/scim-tokens', admin, async (context) => {
    const rows = await options.db
      .select({
        id: scimTokens.id,
        name: scimTokens.name,
        displayPrefix: scimTokens.displayPrefix,
        createdAt: scimTokens.createdAt,
        lastUsedAt: scimTokens.lastUsedAt,
        revokedAt: scimTokens.revokedAt,
      })
      .from(scimTokens)
      .where(eq(scimTokens.workspaceId, options.workspaceId))
      .orderBy(asc(scimTokens.createdAt));
    return context.json({ tokens: rows });
  });

  app.post('/api/v1/scim-tokens', admin, async (context) => {
    const parsed = z
      .object({ name: z.string().trim().min(1).max(100) })
      .safeParse(await context.req.json().catch(() => null));
    if (!parsed.success) {
      return context.json(
        {
          error: {
            code: ErrorCode.INVALID_REQUEST_BODY,
            message: 'Name the connection',
            details: parsed.error.issues,
          },
        },
        400,
      );
    }
    const actor = (await callerOf(context, options.access)).actor;
    const created = await createScimToken(options, parsed.data.name, actor);
    await audit(options, {
      actor,
      action: 'scim-token.create',
      resourceType: 'scim_token',
      resourceId: created.summary.id,
    });
    return context.json(created, 201);
  });

  app.delete('/api/v1/scim-tokens/:id', admin, async (context) => {
    const id = context.req.param('id');
    if (!z.string().uuid().safeParse(id).success)
      throw new DomainError(ErrorCode.NOT_FOUND, 'No such token');
    const revoked = await options.db
      .update(scimTokens)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(scimTokens.workspaceId, options.workspaceId),
          eq(scimTokens.id, id),
          isNull(scimTokens.revokedAt),
        ),
      )
      .returning({ id: scimTokens.id });
    if (revoked.length === 0) throw new DomainError(ErrorCode.NOT_FOUND, 'No such token');
    await audit(options, {
      actor: (await callerOf(context, options.access)).actor,
      action: 'scim-token.revoke',
      resourceType: 'scim_token',
      resourceId: id,
    });
    return context.json({ ok: true });
  });

  return app;
}
