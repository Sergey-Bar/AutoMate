import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { afterEach, describe, expect, it } from 'vitest';
import * as schema from '@automate/db';
import { createAccessToken, revokeAccessToken } from '../services/access-service.js';
import { migratedDatabase, type MigratedDb } from '../test-support/migrated-database.js';
import { createWorkspaceDispatch } from './workspace-dispatch.js';
import { createDatabaseWorkspaceLookups } from './workspace-lookups.js';

/**
 * The rows the dispatch reads a request's workspace from (ADR-014, team), against the real
 * migration graph. These are the queries that decide which workspace's data a credential
 * reaches, so each is proved on rows rather than on a double: a token reaches its own
 * workspace and no other, a revoked token reaches none, a job names its own, and a person's
 * memberships come back oldest first.
 */
const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

async function harness() {
  const { db, close } = await migratedDatabase();
  closers.push(close);
  const lookups = createDatabaseWorkspaceLookups({
    db: db as never,
    defaultWorkspace: 'ws-1',
    sessionUser: async (context) => context.req.header('x-test-user') ?? null,
    installationLevel: async () => false,
  });
  return { db, lookups };
}

async function job(db: MigratedDb, workspaceId: string): Promise<string> {
  const runId = randomUUID();
  await db.insert(schema.runs).values({
    id: runId,
    workspaceId,
    externalId: runId,
    startedAt: new Date(),
  } as never);
  const [row] = await db
    .insert(schema.executionJobs)
    .values({ workspaceId, runId, timeoutMs: 60_000, idempotencyKey: runId })
    .returning({ id: schema.executionJobs.id });
  return String(row?.id);
}

describe('the workspace lookups', () => {
  it('reads a token’s own workspace, and nothing for a revoked or unknown token', async () => {
    const { db, lookups } = await harness();
    const two = await createAccessToken(
      { db: db as never, workspaceId: 'ws-2' },
      { name: 'ci', role: 'viewer' },
      'session',
    );
    expect(await lookups.tokenWorkspace(two.token)).toBe('ws-2');
    expect(await lookups.tokenWorkspace('amt_not-a-token')).toBeNull();
    await revokeAccessToken({ db: db as never, workspaceId: 'ws-2' }, two.summary.id);
    expect(await lookups.tokenWorkspace(two.token)).toBeNull();
  });

  it('reads a job’s workspace, and refuses an id that is not a job id before querying', async () => {
    const { db, lookups } = await harness();
    const id = await job(db, 'ws-2');
    expect(await lookups.jobWorkspace(id)).toBe('ws-2');
    expect(await lookups.jobWorkspace(id.toUpperCase())).toBe('ws-2');
    expect(await lookups.jobWorkspace('00000000-0000-4000-8000-000000000000')).toBeNull();
    expect(await lookups.jobWorkspace("x' or 1=1 --")).toBeNull();
    // A uuid's length is not a uuid: PostgreSQL would refuse this one as malformed, a 400 for
    // what is a job nobody has.
    expect(await lookups.jobWorkspace('-'.repeat(36))).toBeNull();
  });

  it('lists a person’s memberships oldest first, and knows which workspaces exist', async () => {
    const { db, lookups } = await harness();
    const now = Date.now();
    const [user] = await db
      .insert(schema.users)
      .values({
        email: 'ana@example.com',
        displayName: 'Ana',
        createdAt: new Date(now),
        updatedAt: new Date(now),
      })
      .returning({ id: schema.users.id });
    const userId = String(user?.id);
    await db.insert(schema.workspaceMembers).values([
      { workspaceId: 'ws-2', userId, role: 'viewer', createdAt: new Date(now - 1000) },
      { workspaceId: 'ws-1', userId, role: 'admin', createdAt: new Date(now) },
    ]);
    expect(await lookups.memberships(userId)).toEqual(['ws-2', 'ws-1']);
    expect(await lookups.memberships('00000000-0000-4000-8000-000000000000')).toEqual([]);
    expect(await lookups.workspaceExists('ws-2')).toBe(true);
    expect(await lookups.workspaceExists('ws-3')).toBe(false);
  });

  it('sends a token to its own workspace’s composition through the dispatch, on real rows', async () => {
    const { db, lookups } = await harness();
    const two = await createAccessToken(
      { db: db as never, workspaceId: 'ws-2' },
      { name: 'ci', role: 'viewer' },
      'session',
    );
    const app = new Hono();
    app.use(
      '*',
      createWorkspaceDispatch({
        lookups,
        compose: (workspaceId) =>
          new Hono().get('/api/v1/runs', (context) => context.text(workspaceId)),
      }),
    );
    app.get('/api/v1/runs', (context) => context.text('ws-1'));
    const ask = async (headers: Record<string, string>) =>
      (await app.request('/api/v1/runs', { headers })).text();
    expect(await ask({ authorization: `Bearer ${two.token}` })).toBe('ws-2');
    expect(
      await ask({ authorization: `Bearer ${two.token}`, cookie: 'automate_workspace=ws-1' }),
    ).toBe('ws-2');
    expect(await ask({})).toBe('ws-1');
  });

  it('sends the reporter secret to the default workspace, whichever one the person beside it chose', async () => {
    const { db, lookups } = await harness();
    const now = new Date();
    const [user] = await db
      .insert(schema.users)
      .values({ email: 'bo@example.com', displayName: 'Bo', createdAt: now, updatedAt: now })
      .returning({ id: schema.users.id });
    const bo = String(user?.id);
    await db
      .insert(schema.workspaceMembers)
      .values({ workspaceId: 'ws-2', userId: bo, role: 'viewer' });
    const app = new Hono();
    app.use(
      '*',
      createWorkspaceDispatch({
        lookups,
        compose: (workspaceId) =>
          new Hono().post('/api/v1/reporter/upload', (context) => context.text(workspaceId)),
      }),
    );
    app.post('/api/v1/reporter/upload', (context) => context.text('ws-1'));
    const upload = async (headers: Record<string, string>) =>
      (
        await app.request('/api/v1/reporter/upload', {
          method: 'POST',
          headers: { 'x-test-user': bo, cookie: 'automate_workspace=ws-2', ...headers },
        })
      ).text();
    // Bo is a viewer of ws-2 and chose it, so his own requests are served there.
    expect(await upload({})).toBe('ws-2');
    // The installation's reporter secret is not his to point anywhere: it writes to the default.
    expect(await upload({ authorization: 'Bearer reporter-secret' })).toBe('ws-1');
    expect(await upload({ 'x-runner-registration-secret': 'shared' })).toBe('ws-1');
  });
});
