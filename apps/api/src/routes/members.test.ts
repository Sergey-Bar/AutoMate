import { eq } from 'drizzle-orm';
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
 * every change audited, the workspace's last admin kept, and a removed or disabled person
 * signed out at once.
 */
const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

const CALLERS: Record<string, Caller> = {
  amt_admin: { actor: 'token:admin', role: 'admin', uploaderFor: null },
  amt_viewer: { actor: 'token:viewer', role: 'viewer', uploaderFor: null },
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
  await db
    .insert(schema.workspaceMembers)
    .values({ workspaceId: workspace, userId: id, role: role as 'viewer' });
  return id;
}

async function harness() {
  const { db, close } = await migratedDatabase();
  closers.push(close);
  const access: CallerResolver = {
    mode: 'enforced',
    authenticateToken: async (token) => CALLERS[token] ?? null,
    hasSession: async () => false,
  };
  const ana = await person(db, 'ana@example.com', 'ws-1', 'admin');
  const bo = await person(db, 'bo@example.com', 'ws-1', 'viewer');
  const other = await person(db, 'eve@example.com', 'ws-2', 'admin');
  const app = withErrorBoundary(
    createMembersRoutes({ db: db as never, workspaceId: 'ws-1', access }),
  );
  const call = (method: string, path: string, body?: unknown, token = 'amt_admin') =>
    app.request(path, {
      method,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  return { db, call, ana, bo, other };
}

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

  it('keeps the last admin: it can be neither demoted nor removed', async () => {
    const { call, ana } = await harness();
    const demote = await call('PATCH', `/api/v1/members/${ana}`, { role: 'viewer' });
    expect(demote.status).toBe(409);
    expect(((await demote.json()) as { error: { code: string } }).error.code).toBe('LAST_ADMIN');
    expect((await call('DELETE', `/api/v1/members/${ana}`)).status).toBe(409);
  });

  it('signs a removed person out at once, and a disabled one too', async () => {
    const { call, db, bo, ana } = await harness();
    const sessions = new DrizzleSessionStore(db as never);
    const later = new Date(Date.now() + 3_600_000);
    for (const [userId, hash] of [
      [bo, 'h-bo'],
      [ana, 'h-ana'],
    ] as const) {
      await sessions.create({
        installationId: '00000000-0000-4000-8000-000000000001',
        tokenHash: hash,
        issuedAt: new Date(),
        expiresAt: later,
        userId,
      });
    }
    expect((await call('DELETE', `/api/v1/members/${bo}`)).status).toBe(200);
    expect(await sessions.findValid('h-bo', new Date())).toBeUndefined();
    expect(await call('PATCH', `/api/v1/members/${bo}`, { role: 'viewer' })).toMatchObject({
      status: 404,
    });
    // Disabling needs a second admin, because the first is the last one.
    await call('PATCH', `/api/v1/members/${ana}`, { disabled: true });
    expect(await sessions.findValid('h-ana', new Date())).toBeDefined();
  });

  it('disables a person, which revokes their sessions, and enables them again', async () => {
    const { call, db, bo } = await harness();
    const sessions = new DrizzleSessionStore(db as never);
    await sessions.create({
      installationId: '00000000-0000-4000-8000-000000000001',
      tokenHash: 'h-bo',
      issuedAt: new Date(),
      expiresAt: new Date(Date.now() + 3_600_000),
      userId: bo,
    });
    expect((await call('PATCH', `/api/v1/members/${bo}`, { disabled: true })).status).toBe(200);
    expect(await sessions.findValid('h-bo', new Date())).toBeUndefined();
    const listed = (await (await call('GET', '/api/v1/members')).json()) as {
      members: Array<{ email: string; disabled: boolean }>;
    };
    expect(listed.members.find((member) => member.email === 'bo@example.com')?.disabled).toBe(true);
    expect((await call('PATCH', `/api/v1/members/${bo}`, { disabled: false })).status).toBe(200);
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
