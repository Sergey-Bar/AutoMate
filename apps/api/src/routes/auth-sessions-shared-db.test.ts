import { afterEach, describe, expect, it } from 'vitest';
import { hashCredential } from '@automate/auth';
import * as schema from '@automate/db';
import { DrizzleSessionStore } from '@automate/db';
import { DrizzleAuthSessionBackend } from '../infrastructure/session-backend.js';
import { withErrorBoundary } from '../test-support/error-boundary-app.js';
import { migratedDatabase, type MigratedDb } from '../test-support/migrated-database.js';
import {
  syntheticCookieSecret,
  syntheticInstallationKey,
} from '../test-support/synthetic-credentials.js';
import { createAuthRoutes } from './auth.js';

/**
 * `auth.sessions`: two API compositions over **one** database, as two instances behind one
 * load balancer are. Each test drives instance A and instance B through their own routes and
 * their own `DrizzleAuthSessionBackend`, and the only thing they share is the PostgreSQL
 * schema the real migration graph built — so a session issued by one and honoured by the
 * other, or revoked by one and refused by the other, is a property of the table and not of a
 * process-local map.
 */

const COOKIE_SECRET = syntheticCookieSecret();
const API_KEY = syntheticInstallationKey();
const INSTALLATION_ID = '00000000-0000-4000-8000-000000000001';
const TTL_MS = 60 * 60_000;
const RETENTION_MS = 24 * 60 * 60_000;
const COOKIE = 'automate_session';

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

function instance(db: MigratedDb, clock: () => Date) {
  const backend = new DrizzleAuthSessionBackend(
    new DrizzleSessionStore(db as never),
    COOKIE_SECRET,
    TTL_MS,
    RETENTION_MS,
    clock,
  );
  const routes = createAuthRoutes({
    cookieSecret: COOKIE_SECRET,
    installationId: INSTALLATION_ID,
    installationKeyHash: hashCredential(COOKIE_SECRET, API_KEY),
    sessionTtlMs: TTL_MS,
    secureCookies: false,
    now: clock,
    sessionBackend: backend,
  });
  const app = withErrorBoundary(routes.app);
  return {
    backend,
    login: async (): Promise<string> => {
      const response = await app.request('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ apiKey: API_KEY }),
      });
      expect(response.status).toBe(200);
      const match = new RegExp(`${COOKIE}=([^;]*)`).exec(response.headers.get('set-cookie') ?? '');
      return match?.[1] as string;
    },
    session: async (token: string) =>
      (await app.request('/api/v1/auth/session', { headers: { cookie: `${COOKIE}=${token}` } }))
        .status,
    logout: async (token: string) =>
      (
        await app.request('/api/v1/auth/logout', {
          method: 'POST',
          headers: { cookie: `${COOKIE}=${token}` },
        })
      ).status,
  };
}

async function twoInstances() {
  const { db, close } = await migratedDatabase();
  closers.push(close);
  let now = new Date('2026-10-26T12:00:00.000Z');
  const clock = () => now;
  return {
    db,
    a: instance(db, clock),
    b: instance(db, clock),
    advance: (ms: number) => {
      now = new Date(now.getTime() + ms);
    },
  };
}

describe('sessions shared by two API instances over one database', () => {
  it('honours on B a session A issued, and stores only its hash', async () => {
    const { db, a, b } = await twoInstances();
    const token = await a.login();
    expect(await b.session(token)).toBe(200);
    const rows = await db.select().from(schema.sessions);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tokenHash).toBe(hashCredential(COOKIE_SECRET, token));
    expect(JSON.stringify(rows)).not.toContain(token);
  });

  it('refuses on A a session B revoked, and only that session', async () => {
    const { a, b } = await twoInstances();
    const revoked = await a.login();
    const other = await a.login();
    expect(await b.logout(revoked)).toBe(200);
    expect(await a.session(revoked)).toBe(401);
    expect(await a.session(other)).toBe(200);
    expect(await b.session(other)).toBe(200);
  });

  it('expires on both instances at the TTL', async () => {
    const { a, b, advance } = await twoInstances();
    const token = await a.login();
    advance(TTL_MS - 1);
    expect(await b.session(token)).toBe(200);
    advance(1);
    expect(await a.session(token)).toBe(401);
    expect(await b.session(token)).toBe(401);
  });

  it('sweeps, from either instance, only the rows past the retention window', async () => {
    const { db, a, b, advance } = await twoInstances();
    const aged = await a.login();
    advance(RETENTION_MS - TTL_MS);
    const recent = await b.login();
    // The first row is now just inside retention: expired, kept, so "was it ever valid"
    // still has an answer.
    expect(await b.backend.sweep()).toEqual({ removed: 0 });
    expect(await db.select().from(schema.sessions)).toHaveLength(2);
    advance(TTL_MS + 1);
    expect(await b.backend.sweep()).toEqual({ removed: 1 });
    const left = await db.select({ tokenHash: schema.sessions.tokenHash }).from(schema.sessions);
    expect(left.map((row) => row.tokenHash)).toEqual([hashCredential(COOKIE_SECRET, recent)]);
    expect(await a.session(aged)).toBe(401);
    // A sweep with nothing to remove is a no-op on the other instance too.
    expect(await a.backend.sweep()).toEqual({ removed: 0 });
  });
});
