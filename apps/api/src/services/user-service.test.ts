import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import * as schema from '@automate/db';
import { migratedDatabase } from '../test-support/migrated-database.js';
import { signInPerson, type SignInClaims, type SignInPolicy } from './user-service.js';

/**
 * Signing a person in (ADR-014, team), against the real migration graph. A Cloudflare person's
 * first page load is several requests at once, and each one is a sign-in, so a first sign-in
 * has to be safe to run twice concurrently — and a collision the unique indexes catch has to
 * be an answer the sign-in screen can give, not a 409.
 */
const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

const ISSUER = 'https://login.example.com';
const BO: SignInClaims = {
  issuer: ISSUER,
  subject: 'sub-bo',
  email: 'bo@example.com',
  name: 'Bo',
  groups: [],
};
const POLICY: SignInPolicy = { roleMap: [], defaultRole: 'viewer' };

async function setup() {
  const { db, close } = await migratedDatabase();
  closers.push(close);
  return { db, scope: { db: db as never, workspaceId: 'ws-1' } };
}

describe('signing a person in', () => {
  it('makes one person and one membership of two first sign-ins at once', async () => {
    const { db, scope } = await setup();
    const [first, second] = await Promise.all([
      signInPerson(scope, BO, POLICY),
      signInPerson(scope, BO, POLICY),
    ]);
    expect(first).toMatchObject({ ok: true, role: 'viewer' });
    expect(second).toEqual(first);
    expect(await db.select().from(schema.users)).toHaveLength(1);
    expect(await db.select().from(schema.workspaceMembers)).toHaveLength(1);
  });

  it('refuses a returning person whose provider now names an email another person holds', async () => {
    const { db, scope } = await setup();
    expect(await signInPerson(scope, BO, POLICY)).toMatchObject({ ok: true });
    const now = new Date();
    await db.insert(schema.users).values({
      email: 'cy@example.com',
      displayName: 'Cy',
      issuer: ISSUER,
      subject: 'sub-cy',
      createdAt: now,
      updatedAt: now,
    });
    expect(await signInPerson(scope, { ...BO, email: 'Cy@Example.com' }, POLICY)).toEqual({
      ok: false,
      reason: 'email-taken',
    });
    // Bo keeps the address they had, and Cy keeps theirs.
    const [bo] = await db
      .select({ email: schema.users.email })
      .from(schema.users)
      .where(eq(schema.users.subject, 'sub-bo'));
    expect(bo?.email).toBe('bo@example.com');
  });

  it('refuses a new person whose email another identity holds, without merging the two', async () => {
    const { db, scope } = await setup();
    expect(await signInPerson(scope, BO, POLICY)).toMatchObject({ ok: true });
    expect(
      await signInPerson(scope, { ...BO, issuer: 'https://other.example.com' }, POLICY),
    ).toEqual({ ok: false, reason: 'email-taken' });
    expect(await db.select().from(schema.users)).toHaveLength(1);
  });
});
