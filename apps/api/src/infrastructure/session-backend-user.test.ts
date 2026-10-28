import { afterEach, describe, expect, it } from 'vitest';
import * as schema from '@automate/db';
import { DrizzleSessionStore } from '@automate/db';
import { memoryBackend } from '../routes/auth.js';
import { migratedDatabase } from '../test-support/migrated-database.js';
import { syntheticCookieSecret } from '../test-support/synthetic-credentials.js';
import { DrizzleAuthSessionBackend } from './session-backend.js';

/**
 * A session that signs a person in (ADR-014, team). Every session before this one was the
 * installation's, and the installation's session is the admin — so the person a session
 * belongs to has to survive the round trip, or a person's sign-in would read as the admin.
 */
const COOKIE_SECRET = syntheticCookieSecret();
const INSTALLATION = '00000000-0000-4000-8000-000000000001';
const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

describe('a person’s session', () => {
  it('keeps the person through issue and validate, and the installation’s stays nobody’s', async () => {
    const { db, close } = await migratedDatabase();
    closers.push(close);
    const [user] = await db
      .insert(schema.users)
      .values({
        email: 'ana@example.com',
        displayName: 'Ana',
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning({ id: schema.users.id });
    const backend = new DrizzleAuthSessionBackend(
      new DrizzleSessionStore(db as never),
      COOKIE_SECRET,
      60_000,
      600_000,
    );
    const person = await backend.issue(INSTALLATION, user?.id);
    const installation = await backend.issue(INSTALLATION);
    expect((await backend.validate(person.token))?.userId).toBe(user?.id);
    expect((await backend.validate(installation.token))?.userId).toBeUndefined();
  });

  it('is refused by the in-memory backend, which has nobody to sign in', async () => {
    // Accepting the id and dropping it would hand a person the installation's admin session.
    const backend = memoryBackend(COOKIE_SECRET, 60_000);
    await expect(
      backend.issue(INSTALLATION, '00000000-0000-4000-8000-0000000000a1'),
    ).rejects.toThrow(/person/u);
  });
});
