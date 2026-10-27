import { afterEach, describe, expect, it } from 'vitest';
import * as schema from '@automate/db';
import type { Caller } from '../services/access-service.js';
import { createAccessToken } from '../services/access-service.js';
import { withErrorBoundary } from '../test-support/error-boundary-app.js';
import { migratedDatabase, type MigratedDb } from '../test-support/migrated-database.js';
import { createWorkspacesRoutes } from './workspaces.js';

/**
 * Workspaces (ADR-014, team): the ones a caller may enter, choosing one, and creating one. A
 * token belongs to one workspace and cannot choose; a person enters the workspaces they are a
 * member of; the installation's own admin enters any, and creates them on `team` and up.
 */
const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

async function person(db: MigratedDb, email: string, roles: Record<string, 'viewer' | 'admin'>) {
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
  for (const [workspaceId, role] of Object.entries(roles)) {
    await db.insert(schema.workspaceMembers).values({ workspaceId, userId: id, role });
  }
  return id;
}

async function harness(profile: 'startup' | 'team' = 'team') {
  const { db, close } = await migratedDatabase();
  closers.push(close);
  const ana = await person(db, 'ana@example.com', { 'ws-1': 'admin', 'ws-2': 'viewer' });
  const bo = await person(db, 'bo@example.com', { 'ws-2': 'viewer' });
  const { token } = await createAccessToken(
    { db: db as never, workspaceId: 'ws-2' },
    { name: 'ci', role: 'viewer' },
    'session',
  );
  // Who a request is, by header: the routes read it through the injected seams.
  const callers: Record<string, { caller: Caller; userId: string | null }> = {
    admin: { caller: { actor: 'session', role: 'admin', uploaderFor: null }, userId: null },
    ana: { caller: { actor: `user:${ana}`, role: 'admin', uploaderFor: null }, userId: ana },
    bo: { caller: { actor: `user:${bo}`, role: null, uploaderFor: null }, userId: bo },
    nobody: { caller: { actor: 'anonymous', role: null, uploaderFor: null }, userId: null },
  };
  const who = (context: { req: { header: (name: string) => string | undefined } }) =>
    callers[context.req.header('x-test-caller') ?? 'nobody'] ?? callers['nobody'];
  const app = withErrorBoundary(
    createWorkspacesRoutes({
      db: db as never,
      defaultWorkspace: 'ws-1',
      profile,
      secureCookies: false,
      defaultCaller: async (context) => who(context)?.caller as Caller,
      sessionUser: async (context) => who(context)?.userId ?? null,
      current: async () => 'ws-1',
    }),
  );
  const call = (caller: string, method: string, path: string, body?: unknown, extra = {}) =>
    app.request(path, {
      method,
      headers: { 'x-test-caller': caller, 'content-type': 'application/json', ...extra },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  return { db, call, token, ana, bo };
}

const ids = async (response: Response) =>
  ((await response.json()) as { workspaces: Array<{ id: string; role: string }> }).workspaces.map(
    (workspace) => `${workspace.id}:${workspace.role}`,
  );

describe('the workspaces a caller may enter', () => {
  it('are every workspace for the installation’s admin, and a person’s memberships', async () => {
    const { call } = await harness();
    // The migration graph seeds `default-workspace` too; the installation's admin sees it.
    expect(await ids(await call('admin', 'GET', '/api/v1/workspaces'))).toEqual([
      'default-workspace:admin',
      'ws-1:admin',
      'ws-2:admin',
    ]);
    expect(await ids(await call('ana', 'GET', '/api/v1/workspaces'))).toEqual([
      'ws-1:admin',
      'ws-2:viewer',
    ]);
    expect(await ids(await call('bo', 'GET', '/api/v1/workspaces'))).toEqual(['ws-2:viewer']);
  });

  it('are one, for a token: its own', async () => {
    const { call, token } = await harness();
    const response = await call('nobody', 'GET', '/api/v1/workspaces', undefined, {
      authorization: `Bearer ${token}`,
    });
    expect(await ids(response)).toEqual(['ws-2:viewer']);
  });

  it('are none for a caller with no credential, which is refused', async () => {
    const { call } = await harness();
    expect((await call('nobody', 'GET', '/api/v1/workspaces')).status).toBe(401);
  });
});

describe('choosing a workspace', () => {
  it('sets the choice for a workspace the caller may enter', async () => {
    const { call } = await harness();
    const response = await call('bo', 'POST', '/api/v1/workspaces/select', { workspaceId: 'ws-2' });
    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toMatch(/automate_workspace=ws-2;.*HttpOnly/iu);
  });

  it('refuses a workspace the person is not a member of, and a token’s attempt', async () => {
    const { call, token } = await harness();
    expect(
      (await call('bo', 'POST', '/api/v1/workspaces/select', { workspaceId: 'ws-1' })).status,
    ).toBe(403);
    const byToken = await call(
      'nobody',
      'POST',
      '/api/v1/workspaces/select',
      { workspaceId: 'ws-2' },
      { authorization: `Bearer ${token}` },
    );
    expect(byToken.status).toBe(403);
  });
});

describe('creating a workspace', () => {
  it('is the installation admin’s, or a default-workspace admin’s, and makes the person its admin', async () => {
    const { call, db, ana } = await harness();
    const created = await call('ana', 'POST', '/api/v1/workspaces', {
      id: 'mobile',
      name: 'Mobile',
    });
    expect(created.status).toBe(201);
    const members = await db.select().from(schema.workspaceMembers);
    expect(members).toContainEqual(
      expect.objectContaining({ workspaceId: 'mobile', userId: ana, role: 'admin' }),
    );
    expect(
      (await call('admin', 'POST', '/api/v1/workspaces', { id: 'web', name: 'Web' })).status,
    ).toBe(201);
    // A viewer elsewhere is not an admin of the install.
    expect((await call('bo', 'POST', '/api/v1/workspaces', { id: 'x', name: 'X' })).status).toBe(
      403,
    );
  });

  it('refuses a duplicate, a malformed id, and a profile below team', async () => {
    const { call } = await harness();
    expect(
      (await call('admin', 'POST', '/api/v1/workspaces', { id: 'ws-2', name: 'Again' })).status,
    ).toBe(409);
    expect(
      (await call('admin', 'POST', '/api/v1/workspaces', { id: 'Bad Id', name: 'X' })).status,
    ).toBe(400);
    const startup = await harness('startup');
    const refused = await startup.call('admin', 'POST', '/api/v1/workspaces', {
      id: 'x',
      name: 'X',
    });
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { error: { code: string } }).error.code).toBe(
      'WORKSPACES_NEED_TEAM',
    );
  });
});
