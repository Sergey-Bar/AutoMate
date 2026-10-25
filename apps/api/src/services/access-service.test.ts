import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { Hono } from 'hono';
import { afterEach, describe, expect, it } from 'vitest';
import * as schema from '@automate/db';
import { createErrorBoundary } from '../errors/boundary.js';
import type { CallerResolver } from '../http/roles.js';
import { createProjectsRoutes } from '../routes/projects.js';
import { literalView } from '@automate/projects';
import {
  authenticateToken,
  createAccessToken,
  listAccessTokens,
  revokeAccessToken,
  satisfies,
} from './access-service.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const drizzleDirectory = path.resolve(here, '../../../../packages/db/drizzle');

function migrationSql(): string {
  const journal = JSON.parse(
    readFileSync(path.join(drizzleDirectory, 'meta', '_journal.json'), 'utf8'),
  ) as {
    entries: Array<{ idx: number; tag: string }>;
  };
  return journal.entries
    .slice()
    .sort((left, right) => left.idx - right.idx)
    .map((entry) =>
      readFileSync(path.join(drizzleDirectory, `${entry.tag}.sql`), 'utf8')
        .split('--> statement-breakpoint')
        .map((statement) => statement.trim())
        .filter(Boolean)
        .join(';\n'),
    )
    .join(';\n');
}

const clients: PGlite[] = [];
afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

async function setup(mode: 'open' | 'enforced' = 'enforced') {
  const client = new PGlite();
  clients.push(client);
  await client.exec(migrationSql());
  const db = drizzle(client, { schema });
  for (const id of ['ws-1', 'ws-2']) {
    await db
      .insert(schema.workspaces)
      .values({ id, name: id, configPath: '.', createdAt: new Date() });
  }
  const [project] = await db
    .insert(schema.projects)
    .values({ workspaceId: 'ws-1', name: 'Service', slug: 'service' })
    .returning({ id: schema.projects.id });
  const options = { db: db as never, workspaceId: 'ws-1' };
  const access: CallerResolver = {
    mode,
    authenticateToken: (token) => authenticateToken(options, token),
    hasSession: async (context) =>
      context.req.header('cookie')?.includes('automate_session=valid') === true,
  };
  const { onError } = createErrorBoundary({
    log: () => undefined,
    reportError: () => undefined,
    requestId: () => 'R',
  });
  const app = new Hono().onError(onError).route(
    '/',
    createProjectsRoutes({
      db: db as never,
      workspaceId: 'ws-1',
      viewFor: () => literalView({ 'package.json': '{"name":"x"}' }),
      startRun: async () => ({ runId: 'r', jobId: 'j', phase: 'queued' }),
      access,
    }),
  );
  return { db, options, app, projectId: (project as { id: string }).id };
}

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

describe('roles', () => {
  it('orders viewer below operator below admin, and keeps uploader off the ladder', () => {
    expect(satisfies({ actor: 'a', role: 'operator', uploaderFor: null }, 'viewer')).toBe(true);
    expect(satisfies({ actor: 'a', role: 'operator', uploaderFor: null }, 'admin')).toBe(false);
    expect(satisfies({ actor: 'a', role: null, uploaderFor: 'p' }, 'viewer')).toBe(false);
  });
});

describe('access tokens', () => {
  it('stores only a hash, authenticates until revoked, and is shown once', async () => {
    const { options, db } = await setup();
    const { token, summary } = await createAccessToken(
      options,
      { name: 'ci', role: 'viewer' },
      'session',
    );
    expect(token.startsWith('amt_')).toBe(true);
    const rows = await db.select().from(schema.accessTokens);
    expect(JSON.stringify(rows)).not.toContain(token);
    expect(await authenticateToken(options, token)).toEqual({
      actor: `token:${summary.id}`,
      role: 'viewer',
      uploaderFor: null,
    });
    expect((await listAccessTokens(options))[0]?.lastUsedAt).not.toBeNull();
    await revokeAccessToken(options, summary.id);
    expect(await authenticateToken(options, token)).toBeNull();
    await expect(revokeAccessToken(options, summary.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('a token authenticates only in the workspace that issued it', async () => {
    const { options } = await setup();
    const { token } = await createAccessToken(options, { name: 'x', role: 'admin' }, 'session');
    expect(await authenticateToken({ ...options, workspaceId: 'ws-2' }, token)).toBeNull();
    expect(await listAccessTokens({ ...options, workspaceId: 'ws-2' })).toEqual([]);
  });

  it('pins an uploader to a project of this workspace', async () => {
    const { options, projectId } = await setup();
    const { token } = await createAccessToken(
      options,
      { name: 'ci', role: 'uploader', projectId },
      'session',
    );
    expect(await authenticateToken(options, token)).toMatchObject({
      role: null,
      uploaderFor: projectId,
    });
    await expect(
      createAccessToken(
        { ...options, workspaceId: 'ws-2' },
        { name: 'x', role: 'uploader', projectId },
        'session',
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('the role guards, enforced', () => {
  it('refuses no credential with 401 and an unknown token with 401', async () => {
    const { app } = await setup();
    expect((await app.request('/api/v1/projects')).status).toBe(401);
    expect((await app.request('/api/v1/portfolio', { headers: bearer('amt_nobody') })).status).toBe(
      401,
    );
  });

  it('lets a viewer read and refuses it a scan, a triage and a registration', async () => {
    const { app, options, projectId } = await setup();
    const { token } = await createAccessToken(options, { name: 'v', role: 'viewer' }, 'session');
    expect((await app.request('/api/v1/portfolio', { headers: bearer(token) })).status).toBe(200);
    expect(
      (await app.request(`/api/v1/projects/${projectId}/health`, { headers: bearer(token) }))
        .status,
    ).toBe(200);
    expect(
      (
        await app.request(`/api/v1/projects/${projectId}/health/scan`, {
          method: 'POST',
          headers: bearer(token),
        })
      ).status,
    ).toBe(403);
    const register = await app.request('/api/v1/projects', {
      method: 'POST',
      headers: { ...bearer(token), 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'n', slug: 'n', repoPath: '/r' }),
    });
    expect(register.status).toBe(403);
    expect((await app.request('/api/v1/access-tokens', { headers: bearer(token) })).status).toBe(
      403,
    );
  });

  it('lets an operator register and audits it, but not issue tokens', async () => {
    const { app, options, db } = await setup();
    const { token, summary } = await createAccessToken(
      options,
      { name: 'o', role: 'operator' },
      'session',
    );
    const register = await app.request('/api/v1/projects', {
      method: 'POST',
      headers: { ...bearer(token), 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'New', slug: 'new', repoPath: '/repos/new' }),
    });
    expect(register.status).toBe(201);
    const events = await db.select().from(schema.auditEvents);
    expect(events.map((event) => [event.action, event.actorId])).toContainEqual([
      'project.register',
      `token:${summary.id}`,
    ]);
    expect((await app.request('/api/v1/access-tokens', { headers: bearer(token) })).status).toBe(
      403,
    );
  });

  it('treats the installation session as admin: it issues and revokes tokens', async () => {
    const { app } = await setup();
    const cookie = { cookie: 'automate_session=valid' };
    const created = await app.request('/api/v1/access-tokens', {
      method: 'POST',
      headers: { ...cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'viewer for Ana', role: 'viewer' }),
    });
    expect(created.status).toBe(201);
    const { summary, token } = (await created.json()) as { token: string; summary: { id: string } };
    const listed = (await (
      await app.request('/api/v1/access-tokens', { headers: cookie })
    ).json()) as { tokens: unknown[] };
    expect(JSON.stringify(listed)).not.toContain(token);
    expect(
      (
        await app.request(`/api/v1/access-tokens/${summary.id}`, {
          method: 'DELETE',
          headers: cookie,
        })
      ).status,
    ).toBe(200);
    expect((await app.request('/api/v1/portfolio', { headers: bearer(token) })).status).toBe(401);
  });

  it('lets an uploader send reports to its own project only, and read nothing', async () => {
    const { app, options, db, projectId } = await setup();
    const [other] = await db
      .insert(schema.projects)
      .values({ workspaceId: 'ws-1', name: 'Other', slug: 'other' })
      .returning({ id: schema.projects.id });
    const { token } = await createAccessToken(
      options,
      { name: 'ci', role: 'uploader', projectId },
      'session',
    );
    const sarif = JSON.stringify({
      version: '2.1.0',
      runs: [{ tool: { driver: { name: 'gitleaks' } }, results: [] }],
    });
    const send = (id: string) =>
      app.request(`/api/v1/projects/${id}/health/reports?format=sarif`, {
        method: 'POST',
        headers: bearer(token),
        body: sarif,
      });
    expect((await send(projectId)).status).toBe(201);
    expect((await send((other as { id: string }).id)).status).toBe(403);
    // Known, and not allowed: forbidden rather than unauthenticated.
    expect(
      (await app.request(`/api/v1/projects/${projectId}/health`, { headers: bearer(token) }))
        .status,
    ).toBe(403);
  });

  it('signs a browser in with a token cookie, and refuses an uploader token there', async () => {
    const { app, options, projectId } = await setup();
    const { token } = await createAccessToken(options, { name: 'v', role: 'viewer' }, 'session');
    const login = await app.request('/api/v1/auth/token-login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    expect(login.status).toBe(200);
    const cookie = login.headers.get('set-cookie') ?? '';
    expect(cookie).toMatch(/automate_token=.*HttpOnly/iu);
    const who = await app.request('/api/v1/auth/whoami', {
      headers: { cookie: cookie.split(';')[0] ?? '' },
    });
    expect(await who.json()).toMatchObject({ role: 'viewer', mode: 'enforced' });
    const ci = await createAccessToken(
      options,
      { name: 'ci', role: 'uploader', projectId },
      'session',
    );
    const refused = await app.request('/api/v1/auth/token-login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: ci.token }),
    });
    expect(refused.status).toBe(401);
  });
});

describe('the role guards, open', () => {
  it('admits a caller with no credential, as ADR-006 describes', async () => {
    const { app } = await setup('open');
    expect((await app.request('/api/v1/portfolio')).status).toBe(200);
    expect(await (await app.request('/api/v1/auth/whoami')).json()).toMatchObject({
      role: 'admin',
      mode: 'open',
    });
  });
});
