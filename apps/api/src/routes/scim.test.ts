import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import * as schema from '@automate/db';
import { DrizzleSessionStore } from '@automate/db';
import type { CallerResolver } from '../http/roles.js';
import type { Caller } from '../services/access-service.js';
import { signInPerson } from '../services/user-service.js';
import { withErrorBoundary } from '../test-support/error-boundary-app.js';
import { migratedDatabase } from '../test-support/migrated-database.js';
import { createScimRoutes, createScimToken } from './scim.js';

/**
 * SCIM 2.0 provisioning (ADR-014, enterprise): the identity provider creates people, changes
 * their role through the three role groups, and deactivates them — which signs them out at
 * once. The SCIM token is the workspace's, stored only as a hash.
 */
const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

const ADMIN: Caller = { actor: 'token:admin', role: 'admin', uploaderFor: null };
const SCIM_JSON = 'application/scim+json';
const USER_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:User';
const PATCH_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:PatchOp';

async function harness() {
  const { db, close } = await migratedDatabase();
  closers.push(close);
  const access: CallerResolver = {
    mode: 'enforced',
    authenticateToken: async (token) => (token === 'amt_admin' ? ADMIN : null),
    hasSession: async () => false,
  };
  const options = { db: db as never, workspaceId: 'ws-1', access, defaultRole: 'viewer' as const };
  const app = withErrorBoundary(createScimRoutes(options));
  const { token } = await createScimToken(options, 'Entra', 'token:admin');
  const other = await createScimToken({ ...options, workspaceId: 'ws-2' }, 'Okta', 'token:admin');
  const scim = (method: string, path: string, body?: unknown, bearer = token) =>
    app.request(path, {
      method,
      headers: { authorization: `Bearer ${bearer}`, 'content-type': SCIM_JSON },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  return { db, app, scim, token, otherToken: other.token, options };
}

const ANA = {
  schemas: [USER_SCHEMA],
  userName: 'Ana@Example.com',
  externalId: 'entra-0001',
  name: { givenName: 'Ana', familyName: 'Ng' },
  emails: [{ value: 'ana@example.com', primary: true }],
  active: true,
};

async function create(h: Awaited<ReturnType<typeof harness>>, body: unknown = ANA) {
  const response = await h.scim('POST', '/scim/v2/Users', body);
  expect(response.status).toBe(201);
  expect(response.headers.get('content-type')).toMatch(/application\/scim\+json/u);
  return (await response.json()) as { id: string; userName: string; active: boolean };
}

describe('SCIM users', () => {
  it('creates a person with the default role, and finds them by userName or externalId', async () => {
    const h = await harness();
    const created = await create(h);
    expect(created).toMatchObject({ userName: 'ana@example.com', active: true });
    const [member] = await h.db
      .select({ role: schema.workspaceMembers.role })
      .from(schema.workspaceMembers)
      .where(eq(schema.workspaceMembers.userId, created.id));
    expect(member?.role).toBe('viewer');
    for (const filter of ['userName eq "ana@example.com"', 'externalId eq "entra-0001"']) {
      const list = (await (
        await h.scim('GET', `/scim/v2/Users?filter=${encodeURIComponent(filter)}`)
      ).json()) as { totalResults: number; Resources: Array<{ id: string }> };
      expect(list.totalResults, filter).toBe(1);
      expect(list.Resources[0]?.id).toBe(created.id);
    }
    const none = (await (
      await h.scim('GET', `/scim/v2/Users?filter=${encodeURIComponent('userName eq "nobody@x"')}`)
    ).json()) as { totalResults: number };
    expect(none.totalResults).toBe(0);
  });

  it('answers a second create of the same person with 409 uniqueness', async () => {
    const h = await harness();
    await create(h);
    const again = await h.scim('POST', '/scim/v2/Users', ANA);
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ scimType: 'uniqueness', status: '409' });
  });

  it('deactivates with either PATCH dialect, and the person is signed out at once', async () => {
    const h = await harness();
    const created = await create(h);
    const sessions = new DrizzleSessionStore(h.db as never);
    await sessions.create({
      installationId: '00000000-0000-4000-8000-000000000001',
      tokenHash: 'h-ana',
      issuedAt: new Date(),
      expiresAt: new Date(Date.now() + 3_600_000),
      userId: created.id,
    });
    // Entra: a path, a capitalised op and a string boolean.
    const entra = await h.scim('PATCH', `/scim/v2/Users/${created.id}`, {
      schemas: [PATCH_SCHEMA],
      Operations: [{ op: 'Replace', path: 'active', value: 'False' }],
    });
    expect(entra.status).toBe(200);
    expect(((await entra.json()) as { active: boolean }).active).toBe(false);
    expect(await sessions.findValid('h-ana', new Date())).toBeUndefined();
    // Okta: no path, a value object.
    const okta = await h.scim('PATCH', `/scim/v2/Users/${created.id}`, {
      schemas: [PATCH_SCHEMA],
      Operations: [{ op: 'replace', value: { active: true } }],
    });
    expect(((await okta.json()) as { active: boolean }).active).toBe(true);
  });

  it('removes a person from this workspace on DELETE, and signs them out', async () => {
    const h = await harness();
    const created = await create(h);
    expect((await h.scim('DELETE', `/scim/v2/Users/${created.id}`)).status).toBe(204);
    expect((await h.scim('GET', `/scim/v2/Users/${created.id}`)).status).toBe(404);
    const [user] = await h.db
      .select({ disabledAt: schema.users.disabledAt })
      .from(schema.users)
      .where(eq(schema.users.id, created.id));
    expect(user?.disabledAt).not.toBeNull();
  });

  it('lets the provisioned person sign in with single sign-on the first time', async () => {
    const h = await harness();
    const created = await create(h);
    const outcome = await signInPerson(
      { db: h.db as never, workspaceId: 'ws-1' },
      {
        issuer: 'https://idp.example.com',
        subject: 'sub-ana',
        email: 'ana@example.com',
        name: 'Ana',
        groups: [],
      },
      { roleMap: [], defaultRole: null },
    );
    // Provisioned, so known: no default role is needed, and the same row is linked.
    expect(outcome).toEqual({ ok: true, userId: created.id, role: 'viewer' });
  });
});

describe('SCIM groups are the three roles', () => {
  it('lists viewer, operator and admin, and a member added to one gets that role', async () => {
    const h = await harness();
    const created = await create(h);
    const groups = (await (await h.scim('GET', '/scim/v2/Groups')).json()) as {
      Resources: Array<{ id: string; displayName: string }>;
    };
    expect(groups.Resources.map((group) => group.displayName)).toEqual([
      'automate-viewer',
      'automate-operator',
      'automate-admin',
    ]);
    const response = await h.scim('PATCH', '/scim/v2/Groups/admin', {
      schemas: [PATCH_SCHEMA],
      Operations: [{ op: 'add', path: 'members', value: [{ value: created.id }] }],
    });
    expect(response.status).toBe(204);
    const [member] = await h.db
      .select({ role: schema.workspaceMembers.role })
      .from(schema.workspaceMembers)
      .where(eq(schema.workspaceMembers.userId, created.id));
    expect(member?.role).toBe('admin');
    // Removed from the admin group: back to the default role, not to nothing.
    await h.scim('PATCH', '/scim/v2/Groups/admin', {
      schemas: [PATCH_SCHEMA],
      Operations: [{ op: 'remove', path: `members[value eq "${created.id}"]` }],
    });
    const [after] = await h.db
      .select({ role: schema.workspaceMembers.role })
      .from(schema.workspaceMembers)
      .where(eq(schema.workspaceMembers.userId, created.id));
    expect(after?.role).toBe('viewer');
  });
});

describe('the SCIM token', () => {
  it('refuses no token, a wrong one, an access token, and another workspace’s', async () => {
    const h = await harness();
    const created = await create(h);
    expect((await h.scim('GET', '/scim/v2/Users', undefined, 'scim_wrong')).status).toBe(401);
    expect((await h.scim('GET', '/scim/v2/Users', undefined, 'amt_admin')).status).toBe(401);
    expect(
      (await h.scim('GET', `/scim/v2/Users/${created.id}`, undefined, h.otherToken)).status,
    ).toBe(404);
  });

  it('is issued and revoked by an admin, shown once, and stored only as a hash', async () => {
    const h = await harness();
    const admin = (method: string, path: string, body?: unknown) =>
      h.app.request(path, {
        method,
        headers: { authorization: 'Bearer amt_admin', 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    const issued = await admin('POST', '/api/v1/scim-tokens', { name: 'Okta' });
    expect(issued.status).toBe(201);
    const { token, summary } = (await issued.json()) as { token: string; summary: { id: string } };
    expect(token).toMatch(/^scim_/u);
    const rows = await h.db.select().from(schema.scimTokens);
    expect(JSON.stringify(rows)).not.toContain(token);
    expect((await h.scim('GET', '/scim/v2/Users', undefined, token)).status).toBe(200);
    expect((await admin('DELETE', `/api/v1/scim-tokens/${summary.id}`)).status).toBe(200);
    expect((await h.scim('GET', '/scim/v2/Users', undefined, token)).status).toBe(401);
  });

  it('describes itself to the identity provider', async () => {
    const h = await harness();
    const config = (await (await h.scim('GET', '/scim/v2/ServiceProviderConfig')).json()) as {
      patch: { supported: boolean };
      filter: { supported: boolean };
    };
    expect(config.patch.supported).toBe(true);
    expect(config.filter.supported).toBe(true);
  });
});
