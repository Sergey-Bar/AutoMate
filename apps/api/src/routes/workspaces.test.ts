import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import * as schema from '@automate/db';
import type { Caller } from '../services/access-service.js';
import { createAccessToken, revokeAccessToken } from '../services/access-service.js';
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

async function harness(profile: 'startup' | 'team' = 'team', defaultWorkspace = 'ws-1') {
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
    // An admin token of the default workspace sent beside Bo's session: the caller resolver
    // answers for the token, which is never the installation's admin.
    'bo-beside-token': {
      caller: { actor: 'token:ops', role: 'admin', uploaderFor: null },
      userId: bo,
    },
    nobody: { caller: { actor: 'anonymous', role: null, uploaderFor: null }, userId: null },
  };
  const who = (context: { req: { header: (name: string) => string | undefined } }) =>
    callers[context.req.header('x-test-caller') ?? 'nobody'] ?? callers['nobody'];
  const app = withErrorBoundary(
    createWorkspacesRoutes({
      db: db as never,
      defaultWorkspace,
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

  it('pass over a token nobody holds any more to the person who also signed in', async () => {
    const { call, db } = await harness();
    const stale = await createAccessToken(
      { db: db as never, workspaceId: 'ws-2' },
      { name: 'old', role: 'viewer' },
      'session',
    );
    await revokeAccessToken({ db: db as never, workspaceId: 'ws-2' }, stale.summary.id);
    // A revoked token's sign-in cookie, or a bearer nobody issued, beside Bo's session: the
    // caller resolver passes over either to Bo, and so does the switcher.
    for (const extra of [
      { cookie: `automate_token=${stale.token}` },
      { authorization: 'Bearer amt_unknown' },
    ]) {
      const listed = await call('bo', 'GET', '/api/v1/workspaces', undefined, extra);
      expect(listed.status).toBe(200);
      expect(await ids(listed)).toEqual(['ws-2:viewer']);
      const chosen = await call(
        'bo',
        'POST',
        '/api/v1/workspaces/select',
        { workspaceId: 'ws-2' },
        extra,
      );
      expect(chosen.status).toBe(200);
    }
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

  it('accepts the default workspace whatever its id looks like, so a person can come back to it', async () => {
    // `WORKSPACE_ID` may be any non-empty string; the create route's pattern is for new ids.
    const { call, db, bo } = await harness('team', 'Acme_QA');
    await db
      .insert(schema.workspaces)
      .values({ id: 'Acme_QA', name: 'Acme QA', configPath: '.', createdAt: new Date() });
    await db
      .insert(schema.workspaceMembers)
      .values({ workspaceId: 'Acme_QA', userId: bo, role: 'viewer' });
    const back = await call('bo', 'POST', '/api/v1/workspaces/select', { workspaceId: 'Acme_QA' });
    expect(back.status).toBe(200);
    expect(back.headers.get('set-cookie')).toMatch(/automate_workspace=Acme_QA;/u);
    // Only the default is let past the pattern.
    expect(
      (await call('bo', 'POST', '/api/v1/workspaces/select', { workspaceId: 'Other_QA' })).status,
    ).toBe(400);
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

  it('is not a token’s to lend to the person who signed in beside it', async () => {
    const { call, db } = await harness();
    const ops = await createAccessToken(
      { db: db as never, workspaceId: 'ws-1' },
      { name: 'ops', role: 'admin' },
      'session',
    );
    // An admin token of the default workspace beside Bo's session. Bo is an admin nowhere and
    // the token's role is not his: nothing is created, and he is made the admin of nothing.
    const refused = await call(
      'bo-beside-token',
      'POST',
      '/api/v1/workspaces',
      { id: 'grab', name: 'Grab' },
      { authorization: `Bearer ${ops.token}` },
    );
    expect(refused.status).toBe(403);
    expect(
      await db.select().from(schema.workspaces).where(eq(schema.workspaces.id, 'grab')),
    ).toEqual([]);
  });

  it('is not a disabled admin’s', async () => {
    const { call, db, ana } = await harness();
    await db.update(schema.users).set({ disabledAt: new Date() }).where(eq(schema.users.id, ana));
    expect(
      (await call('ana', 'POST', '/api/v1/workspaces', { id: 'late', name: 'Late' })).status,
    ).toBe(403);
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
