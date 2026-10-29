import { eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { afterEach, describe, expect, it } from 'vitest';
import * as schema from '@automate/db';
import { DrizzleSessionStore } from '@automate/db';
import type { CallerResolver } from '../http/roles.js';
import type { Caller } from '../services/access-service.js';
import { withErrorBoundary } from '../test-support/error-boundary-app.js';
import { migratedDatabase, type MigratedDb } from '../test-support/migrated-database.js';
import { createMembersRoutes } from './members.js';

/**
 * Members (ADR-014, team): the people who signed in, and what each may do here. Admin only,
 * every change audited, the last admin of a workspace kept, and a disabled person signed out
 * at once. A person is one account across the installation, so a workspace that shares them
 * with another manages their membership here and nothing more.
 */
const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

const DEFAULT_WORKSPACE = 'ws-1';
const INSTALLATION = '00000000-0000-4000-8000-000000000001';

const CALLERS: Record<string, Caller> = {
  amt_admin: { actor: 'token:admin', role: 'admin', uploaderFor: null },
  amt_viewer: { actor: 'token:viewer', role: 'viewer', uploaderFor: null },
  // The installation's own admin: what the installation session signs in.
  amt_installation: { actor: 'session', role: 'admin', uploaderFor: null },
};

async function person(db: MigratedDb, email: string, workspace: string, role: string) {
  const now = new Date();
  const [user] = await db
    .insert(schema.users)
    .values({
      email,
      displayName: email,
      issuer: 'https://idp',
      subject: email,
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: schema.users.id });
  const id = String(user?.id);
  await member(db, workspace, id, role);
  return id;
}

async function member(db: MigratedDb, workspace: string, userId: string, role: string) {
  await db
    .insert(schema.workspaceMembers)
    .values({ workspaceId: workspace, userId, role: role as 'viewer' });
}

/** A live session for the person, under a hash the test names. */
async function signedIn(db: MigratedDb, userId: string, hash: string) {
  await new DrizzleSessionStore(db as never).create({
    installationId: INSTALLATION,
    tokenHash: hash,
    issuedAt: new Date(),
    expiresAt: new Date(Date.now() + 3_600_000),
    userId,
  });
}

async function harness() {
  const { db, close } = await migratedDatabase();
  closers.push(close);
  // A third workspace, so a person can be shared by two that are not the default.
  await db
    .insert(schema.workspaces)
    .values({ id: 'ws-3', name: 'ws-3', configPath: '.', createdAt: new Date() });
  const ana = await person(db, 'ana@example.com', 'ws-1', 'admin');
  const bo = await person(db, 'bo@example.com', 'ws-1', 'viewer');
  const other = await person(db, 'eve@example.com', 'ws-2', 'admin');
  // Ana signed in: a person, and an admin of the default workspace.
  const callers: Record<string, Caller> = {
    ...CALLERS,
    amt_ana: { actor: `user:${ana}`, role: 'admin', uploaderFor: null },
  };
  const access: CallerResolver = {
    mode: 'enforced',
    authenticateToken: async (token) => callers[token] ?? null,
    hasSession: async () => false,
  };
  const apps = new Map<string, Hono>(
    ['ws-1', 'ws-2', 'ws-3'].map((workspaceId) => [
      workspaceId,
      withErrorBoundary(
        createMembersRoutes({
          db: db as never,
          workspaceId,
          defaultWorkspace: DEFAULT_WORKSPACE,
          access,
        }),
      ),
    ]),
  );
  /** Requests to one workspace's members routes, as its composition serves them. */
  const callIn =
    (workspaceId: string) =>
    (method: string, path: string, body?: unknown, token = 'amt_admin') =>
      (apps.get(workspaceId) as Hono).request(path, {
        method,
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
  const disabledAt = async (userId: string) =>
    (
      await db
        .select({ disabledAt: schema.users.disabledAt })
        .from(schema.users)
        .where(eq(schema.users.id, userId))
    )[0]?.disabledAt;
  return { db, call: callIn('ws-1'), callIn, disabledAt, ana, bo, other };
}

const codeOf = async (response: Response) =>
  ((await response.json()) as { error: { code: string } }).error.code;

describe('members', () => {
  it('lists the people with a role here, and nobody from another workspace', async () => {
    const { call } = await harness();
    const body = (await (await call('GET', '/api/v1/members')).json()) as {
      members: Array<{ email: string; role: string; disabled: boolean }>;
    };
    expect(body.members.map((member) => [member.email, member.role])).toEqual([
      ['ana@example.com', 'admin'],
      ['bo@example.com', 'viewer'],
    ]);
  });

  it('changes a role and records who did it', async () => {
    const { call, db, bo } = await harness();
    const response = await call('PATCH', `/api/v1/members/${bo}`, { role: 'operator' });
    expect(response.status).toBe(200);
    const [row] = await db
      .select({ role: schema.workspaceMembers.role })
      .from(schema.workspaceMembers)
      .where(eq(schema.workspaceMembers.userId, bo));
    expect(row?.role).toBe('operator');
    const audits = await db.select().from(schema.auditEvents);
    expect(audits.map((entry) => [entry.action, entry.actorId])).toContainEqual([
      'member.role',
      'token:admin',
    ]);
  });

  it('keeps the last admin: it can be neither demoted, removed nor disabled', async () => {
    const { call, db, ana } = await harness();
    const sessions = new DrizzleSessionStore(db as never);
    await signedIn(db, ana, 'h-ana');
    const demote = await call('PATCH', `/api/v1/members/${ana}`, { role: 'viewer' });
    expect(demote.status).toBe(409);
    expect(await codeOf(demote)).toBe('LAST_ADMIN');
    expect((await call('DELETE', `/api/v1/members/${ana}`)).status).toBe(409);
    const disable = await call('PATCH', `/api/v1/members/${ana}`, { disabled: true });
    expect(disable.status).toBe(409);
    expect(await codeOf(disable)).toBe('LAST_ADMIN');
    expect(await sessions.findValid('h-ana', new Date())).toBeDefined();
  });

  it('removes a person from this workspace only, and leaves their sessions and account alone', async () => {
    const { call, db, bo, disabledAt } = await harness();
    const sessions = new DrizzleSessionStore(db as never);
    await signedIn(db, bo, 'h-bo');
    expect((await call('DELETE', `/api/v1/members/${bo}`)).status).toBe(200);
    // Roles are read per request, so the membership going is the whole of it: their session
    // still serves any other workspace they are in, and has no role here.
    expect(await sessions.findValid('h-bo', new Date())).toBeDefined();
    expect(await disabledAt(bo)).toBeNull();
    expect(await call('PATCH', `/api/v1/members/${bo}`, { role: 'viewer' })).toMatchObject({
      status: 404,
    });
    const audits = await db.select().from(schema.auditEvents);
    expect(audits.map((entry) => entry.action)).toContain('member.remove');
  });

  it('disables a person, which revokes their sessions, and enables them again', async () => {
    const { call, db, bo } = await harness();
    const sessions = new DrizzleSessionStore(db as never);
    await signedIn(db, bo, 'h-bo');
    expect((await call('PATCH', `/api/v1/members/${bo}`, { disabled: true })).status).toBe(200);
    expect(await sessions.findValid('h-bo', new Date())).toBeUndefined();
    const listed = (await (await call('GET', '/api/v1/members')).json()) as {
      members: Array<{ email: string; disabled: boolean }>;
    };
    expect(listed.members.find((member) => member.email === 'bo@example.com')?.disabled).toBe(true);
    expect((await call('PATCH', `/api/v1/members/${bo}`, { disabled: false })).status).toBe(200);
  });

  /**
   * PRO-17. Access tokens belong to the workspace, and a token a person made records them as
   * its creator (`user:<id>`). Disabling the person used to revoke their sessions and nothing
   * else, so a token they made for CI kept their role after they left.
   */
  it('revokes the tokens a person made: all of them on disable, only this workspace ones on removal', async () => {
    const { call, db, bo, ana } = await harness();
    await member(db, 'ws-2', bo, 'viewer');
    const token = async (workspaceId: string, createdBy: string, name: string) =>
      db.insert(schema.accessTokens).values({
        workspaceId,
        name,
        role: 'operator',
        tokenHash: `hash-${name}`,
        displayPrefix: 'amt_xx',
        createdBy,
      });
    await token('ws-1', `user:${bo}`, 'bo-ci-1');
    await token('ws-2', `user:${bo}`, 'bo-ci-2');
    await token('ws-1', `user:${ana}`, 'ana-ci');
    await token('ws-1', 'session', 'installation-ci');
    const live = async () =>
      (await db.select().from(schema.accessTokens))
        .filter((row) => row.revokedAt === null)
        .map((row) => row.name)
        .sort();

    expect((await call('DELETE', `/api/v1/members/${bo}`)).status).toBe(200);
    expect(await live()).toEqual(['ana-ci', 'bo-ci-2', 'installation-ci']);

    await member(db, 'ws-1', bo, 'viewer');
    // Bo is in two workspaces, so the account is the installation's admin to disable.
    expect(
      (await call('PATCH', `/api/v1/members/${bo}`, { disabled: true }, 'amt_installation')).status,
    ).toBe(200);
    expect(await live()).toEqual(['ana-ci', 'installation-ci']);
    const audits = await db.select().from(schema.auditEvents);
    expect(audits.map((entry) => [entry.action, entry.details])).toContainEqual([
      'member.disable',
      { tokensRevoked: 1 },
    ]);
  });

  it('adds a person who has signed in before to this workspace, with a role', async () => {
    const { call, db, other } = await harness();
    const added = await call('POST', '/api/v1/members', {
      email: 'Eve@Example.com',
      role: 'operator',
    });
    expect(added.status).toBe(201);
    const rows = await db
      .select({
        workspaceId: schema.workspaceMembers.workspaceId,
        role: schema.workspaceMembers.role,
      })
      .from(schema.workspaceMembers)
      .where(eq(schema.workspaceMembers.userId, other));
    expect(rows).toContainEqual({ workspaceId: 'ws-1', role: 'operator' });
    // Again: already a member here.
    expect(
      (await call('POST', '/api/v1/members', { email: 'eve@example.com', role: 'viewer' })).status,
    ).toBe(409);
    // Nobody by that email has signed in: there is nobody to add yet.
    expect(
      (await call('POST', '/api/v1/members', { email: 'zed@example.com', role: 'viewer' })).status,
    ).toBe(404);
  });

  it('cannot reach a person in another workspace', async () => {
    const { call, other } = await harness();
    expect((await call('PATCH', `/api/v1/members/${other}`, { role: 'viewer' })).status).toBe(404);
    expect((await call('DELETE', `/api/v1/members/${other}`)).status).toBe(404);
  });

  it('is the admin’s alone, and refuses a body it cannot read', async () => {
    const { call, bo } = await harness();
    expect((await call('GET', '/api/v1/members', undefined, 'amt_viewer')).status).toBe(403);
    expect((await call('PATCH', `/api/v1/members/${bo}`, { role: 'owner' })).status).toBe(400);
    expect((await call('PATCH', `/api/v1/members/${bo}`, {})).status).toBe(400);
  });
});

describe('a person another workspace shares', () => {
  it('is added, given a role and removed by an admin here, but never disabled by one', async () => {
    const { callIn, db, other, disabledAt } = await harness();
    const elsewhere = callIn('ws-3');
    // Eve is the only admin of ws-2. An admin of ws-3 adds her, which is a membership here.
    expect(
      (await elsewhere('POST', '/api/v1/members', { email: 'eve@example.com', role: 'viewer' }))
        .status,
    ).toBe(201);
    const refused = await elsewhere('PATCH', `/api/v1/members/${other}`, { disabled: true });
    expect(refused.status).toBe(403);
    expect(await codeOf(refused)).toBe('FORBIDDEN');
    expect((await elsewhere('PATCH', `/api/v1/members/${other}`, { disabled: false })).status).toBe(
      403,
    );
    // Refused whole: the role in the same change is not applied either.
    expect(
      (await elsewhere('PATCH', `/api/v1/members/${other}`, { role: 'admin', disabled: true }))
        .status,
    ).toBe(403);
    const roleHere = async () =>
      (
        await db
          .select({
            workspaceId: schema.workspaceMembers.workspaceId,
            role: schema.workspaceMembers.role,
          })
          .from(schema.workspaceMembers)
          .where(eq(schema.workspaceMembers.userId, other))
      ).find((row) => row.workspaceId === 'ws-3')?.role;
    expect(await roleHere()).toBe('viewer');
    // The membership here is this workspace's to manage.
    expect(
      (await elsewhere('PATCH', `/api/v1/members/${other}`, { role: 'operator' })).status,
    ).toBe(200);
    expect(await roleHere()).toBe('operator');
    expect((await elsewhere('DELETE', `/api/v1/members/${other}`)).status).toBe(200);
    expect(await disabledAt(other)).toBeNull();
    // A person in no other workspace is this workspace's to disable.
    const cy = await person(db, 'cy@example.com', 'ws-3', 'viewer');
    expect((await elsewhere('PATCH', `/api/v1/members/${cy}`, { disabled: true })).status).toBe(
      200,
    );
    expect(await disabledAt(cy)).not.toBeNull();
  });

  it('is disabled by an admin of the default workspace, or by the installation’s own', async () => {
    const { call, callIn, db, bo, disabledAt } = await harness();
    const sessions = new DrizzleSessionStore(db as never);
    await member(db, 'ws-2', bo, 'viewer');
    await signedIn(db, bo, 'h-bo');
    // An admin token of the default workspace is a workspace credential, not a person.
    expect((await call('PATCH', `/api/v1/members/${bo}`, { disabled: true })).status).toBe(403);
    // Nor does ws-2's admin decide alone for a person ws-1 shares.
    expect(
      (await callIn('ws-2')('PATCH', `/api/v1/members/${bo}`, { disabled: true })).status,
    ).toBe(403);
    expect(await sessions.findValid('h-bo', new Date())).toBeDefined();
    // Ana is an admin of the default workspace: she decides the account.
    expect(
      (await call('PATCH', `/api/v1/members/${bo}`, { disabled: true }, 'amt_ana')).status,
    ).toBe(200);
    expect(await disabledAt(bo)).not.toBeNull();
    expect(await sessions.findValid('h-bo', new Date())).toBeUndefined();
    // The installation's own admin does too, from any workspace.
    expect(
      (
        await callIn('ws-2')(
          'PATCH',
          `/api/v1/members/${bo}`,
          { disabled: false },
          'amt_installation',
        )
      ).status,
    ).toBe(200);
    expect(await disabledAt(bo)).toBeNull();
  });

  it('cannot be disabled while they are the last admin of any workspace, not only this one', async () => {
    const { call, db, other, disabledAt } = await harness();
    expect(
      (await call('POST', '/api/v1/members', { email: 'eve@example.com', role: 'viewer' })).status,
    ).toBe(201);
    // A viewer here, and the only admin of ws-2: disabling her would leave ws-2 with nobody.
    const last = await call('PATCH', `/api/v1/members/${other}`, { disabled: true }, 'amt_ana');
    expect(last.status).toBe(409);
    expect(await codeOf(last)).toBe('LAST_ADMIN');
    expect(await disabledAt(other)).toBeNull();
    await person(db, 'dee@example.com', 'ws-2', 'admin');
    expect(
      (await call('PATCH', `/api/v1/members/${other}`, { disabled: true }, 'amt_ana')).status,
    ).toBe(200);
    expect(await disabledAt(other)).not.toBeNull();
  });
});
