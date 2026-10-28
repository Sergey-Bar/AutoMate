import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { sign } from 'hono/jwt';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as schema from '@automate/db';
import { parseRoleMap, type CloudflareAccessConfig } from '@automate/config';
import { migratedDatabase, type MigratedDb } from '../test-support/migrated-database.js';
import {
  CF_ACCESS_HEADER,
  createCloudflareAccessVerifier,
  type CloudflareAccessVerifier,
} from './cloudflare-access.js';
import { createCloudflarePeople } from './cloudflare-people.js';
import { WORKSPACE_COOKIE, resolveRequestWorkspace } from './workspace-dispatch.js';
import { createDatabaseWorkspaceLookups } from './workspace-lookups.js';

/**
 * The people Cloudflare Access lets in, as accounts (ADR-014, team and enterprise), against the
 * real migration graph and an Access key set generated for this process. Cloudflare Access is
 * this product's SAML path, so what SCIM, an admin and the role map decide about a person has
 * to reach the people who come in through it — and a machine has to stay a machine.
 */
const TEAM = 'acme.cloudflareaccess.com';
const AUDIENCE = 'aud-0123456789abcdef';
const ISSUER = `https://${TEAM}`;
const START = new Date('2026-10-27T09:00:00.000Z');

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

function signingKey() {
  const kid = randomUUID();
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return {
    privateJwk: { ...privateKey.export({ format: 'jwk' }), kid, alg: 'RS256' as const },
    publicJwk: { ...publicKey.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' },
  };
}

const seconds = () => Math.floor(Date.now() / 1000);

type Claims = Record<string, unknown>;
const ANA: Claims = { email: 'ana@example.com', sub: 'user-ana' };
const BO: Claims = { email: 'bo@example.com', sub: 'user-bo' };
const CI: Claims = { sub: '', email: undefined, common_name: 'ci.client-id.access' };

interface Answer {
  caller: { actor: string; role: string | null } | null;
  userId: string | null;
}

async function harness(access: Partial<CloudflareAccessConfig> = {}) {
  const { db, close } = await migratedDatabase();
  closers.push(close);
  const key = signingKey();
  const real = createCloudflareAccessVerifier(
    { teamDomain: TEAM, audience: AUDIENCE },
    {
      fetch: async () =>
        new Response(JSON.stringify({ keys: [key.publicJwk] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    },
  );
  const verifier: CloudflareAccessVerifier = { verify: vi.fn((token) => real.verify(token)) };
  let clock = START;
  const people = createCloudflarePeople({
    db: db as never,
    defaultWorkspace: 'ws-1',
    verifier,
    access: {
      teamDomain: TEAM,
      audience: AUDIENCE,
      roleMap: parseRoleMap(
        'CF_ACCESS_ROLE_MAP',
        'admin:ana@example.com,operator:service:ci.client-id.access',
      ),
      defaultRole: 'viewer',
      ...access,
    },
    now: () => clock,
  });
  // Asks twice, as the dispatch and then the workspace's resolver do.
  const app = new Hono().get('/:workspace', async (context) => {
    const caller = await people.callerIn(context.req.param('workspace'))(context);
    await people.callerIn(context.req.param('workspace'))(context);
    return context.json({ caller, userId: await people.userId(context) });
  });
  const header = async (claims: Claims) =>
    sign(
      {
        aud: [AUDIENCE],
        iss: ISSUER,
        iat: seconds() - 10,
        nbf: seconds() - 10,
        exp: seconds() + 300,
        type: 'app',
        ...claims,
      },
      key.privateJwk,
      'RS256',
    );
  const as = async (claims: Claims, workspace = 'ws-1'): Promise<Answer> =>
    (await (
      await app.request(`/${workspace}`, { headers: { [CF_ACCESS_HEADER]: await header(claims) } })
    ).json()) as Answer;
  const roleIn = async (workspaceId: string, userId: string) =>
    (
      await db
        .select({ role: schema.workspaceMembers.role })
        .from(schema.workspaceMembers)
        .where(
          and(
            eq(schema.workspaceMembers.workspaceId, workspaceId),
            eq(schema.workspaceMembers.userId, userId),
          ),
        )
    )[0]?.role;
  return {
    db,
    people,
    verifier,
    header,
    as,
    users: () => db.select().from(schema.users),
    roleIn,
    advance: (ms: number) => {
      clock = new Date(clock.getTime() + ms);
    },
  };
}

async function member(db: MigratedDb, workspaceId: string, userId: string, role: 'operator') {
  await db.insert(schema.workspaceMembers).values({ workspaceId, userId, role });
}

describe('a person Cloudflare Access lets in', () => {
  it('becomes an account on their first request, with the role map’s role, and stays one', async () => {
    const h = await harness();
    const first = await h.as(ANA);
    expect(first.caller).toEqual({
      actor: `user:${String(first.userId)}`,
      role: 'admin',
      uploaderFor: null,
    });
    const again = await h.as(ANA);
    expect(again.userId).toBe(first.userId);
    const rows = await h.users();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      email: 'ana@example.com',
      issuer: ISSUER,
      subject: 'user-ana',
    });
    expect(await h.roleIn('ws-1', String(first.userId))).toBe('admin');
    // Anyone the map does not name gets the default role, the first time.
    expect((await h.as(BO)).caller?.role).toBe('viewer');
  });

  it('has no role in a workspace they are not a member of, and their membership’s in one they are', async () => {
    const h = await harness();
    const { userId } = await h.as(ANA);
    // Admin in the default workspace, by the map; nothing in ws-2 until someone adds them.
    expect((await h.as(ANA, 'ws-2')).caller).toEqual({
      actor: `user:${String(userId)}`,
      role: null,
      uploaderFor: null,
    });
    await member(h.db, 'ws-2', String(userId), 'operator');
    expect((await h.as(ANA, 'ws-2')).caller?.role).toBe('operator');
    expect((await h.as(ANA, 'ws-1')).caller?.role).toBe('admin');
  });

  it('is linked to the row SCIM provisioned, by email, and keeps the provisioned role and name', async () => {
    const h = await harness();
    const [provisioned] = await h.db
      .insert(schema.users)
      .values({
        email: 'cy@example.com',
        displayName: 'Cy Provisioned',
        externalId: 'entra-0003',
        createdAt: START,
        updatedAt: START,
      })
      .returning({ id: schema.users.id });
    await member(h.db, 'ws-1', String(provisioned?.id), 'operator');
    const answer = await h.as({ email: 'Cy@Example.com', sub: 'user-cy' });
    expect(answer.userId).toBe(provisioned?.id);
    expect(answer.caller?.role).toBe('operator');
    const [row] = await h.users();
    expect(row).toMatchObject({
      issuer: ISSUER,
      subject: 'user-cy',
      displayName: 'Cy Provisioned',
    });
  });

  it('is refused on their very next request once SCIM deactivates them', async () => {
    const h = await harness();
    const { userId } = await h.as(BO);
    await h.db
      .update(schema.users)
      .set({ disabledAt: START })
      .where(eq(schema.users.id, String(userId)));
    const refused = await h.as(BO);
    expect(refused).toEqual({
      caller: { actor: 'cf:bo@example.com', role: null, uploaderFor: null },
      userId: null,
    });
  });

  it('is admitted only when the map names them, if the default role is none', async () => {
    const h = await harness({ defaultRole: null });
    expect((await h.as(BO)).caller?.role).toBeNull();
    expect(await h.users()).toHaveLength(0);
    expect((await h.as(ANA)).caller?.role).toBe('admin');
  });

  it('is refused, not merged, when another identity already holds their email', async () => {
    const h = await harness();
    await h.db.insert(schema.users).values({
      email: 'dee@example.com',
      displayName: 'Dee',
      issuer: 'https://login.example.com',
      subject: 'oidc-dee',
      createdAt: START,
      updatedAt: START,
    });
    const answer = await h.as({ email: 'dee@example.com', sub: 'user-dee' });
    expect(answer.caller).toEqual({ actor: 'cf:dee@example.com', role: null, uploaderFor: null });
    expect(await h.users()).toHaveLength(1);
  });

  it('has their row rewritten at most once a window when nothing about them changed', async () => {
    const h = await harness();
    const lastSeen = async () => (await h.users())[0]?.lastLoginAt?.toISOString();
    await h.as(ANA);
    expect(await lastSeen()).toBe(START.toISOString());
    h.advance(60_000);
    await h.as(ANA);
    expect(await lastSeen()).toBe(START.toISOString());
    h.advance(5 * 60_000);
    await h.as(ANA);
    expect(await lastSeen()).toBe(new Date(START.getTime() + 6 * 60_000).toISOString());
  });
});

describe('a machine Cloudflare Access lets in', () => {
  it('keeps the role map’s role in every workspace, and never becomes an account', async () => {
    const h = await harness();
    const machine = {
      actor: 'cf-service:ci.client-id.access',
      role: 'operator',
      uploaderFor: null,
    };
    expect((await h.as(CI)).caller).toEqual(machine);
    expect((await h.as(CI, 'ws-2')).caller).toEqual(machine);
    expect(await h.users()).toHaveLength(0);
  });
});

describe('one request', () => {
  it('is verified and looked up once, however many times it is asked', async () => {
    const h = await harness();
    await h.as(ANA);
    await h.as(ANA);
    // Two requests, each asked three times by the route above: two verifications.
    expect(h.verifier.verify).toHaveBeenCalledTimes(2);
  });

  it('with no Access header is nobody to this source', async () => {
    const h = await harness();
    const app = new Hono().get('/', async (context) =>
      context.json({ caller: await h.people.callerIn('ws-1')(context) }),
    );
    expect(await (await app.request('/')).json()).toEqual({ caller: null });
  });
});

describe('the workspace dispatch', () => {
  it('sends a person to the workspace they chose only when they are a member of it', async () => {
    const h = await harness();
    const { userId } = await h.as(ANA);
    const lookups = createDatabaseWorkspaceLookups({
      db: h.db as never,
      defaultWorkspace: 'ws-1',
      sessionUser: (context) => h.people.userId(context),
      installationLevel: async () => false,
    });
    const app = new Hono().get('*', async (context) =>
      context.text(await resolveRequestWorkspace(context, lookups)),
    );
    const ask = async () =>
      (
        await app.request('/api/v1/runs', {
          headers: { [CF_ACCESS_HEADER]: await h.header(ANA), cookie: `${WORKSPACE_COOKIE}=ws-2` },
        })
      ).text();
    expect(await ask()).toBe('ws-1');
    await member(h.db, 'ws-2', String(userId), 'operator');
    expect(await ask()).toBe('ws-2');
  });
});
