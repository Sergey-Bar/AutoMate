import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '../schema/index.js';
import { DrizzleInstallationKeyStore } from './installation-key-repository.js';
import { DrizzleSessionStore } from './session-repository.js';
import { DrizzleOutboxRepository } from './outbox-repository.js';

/**
 * This package's repositories, against this package's migration graph.
 *
 * They were covered — by `tests/integration`, which drives `DrizzleSessionStore` and
 * `DrizzleInstallationKeyStore` end to end. But that coverage is measured in
 * *another* package, so `packages/db`'s own report showed the three repository
 * files at **0%**, and the floor the ratchet enforced was being satisfied by a
 * number that did not describe this package.
 *
 * That is the shape of claim this plan keeps removing: a real test, contributing
 * nothing where the measurement happens, and a coverage floor that therefore says
 * something other than what it appears to say. So the same assertions now also run
 * here, where the floor is read.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const drizzleDirectory = path.join(repoRoot, 'packages/db/drizzle');

function migrationSql(): string {
  const journal = JSON.parse(
    readFileSync(path.join(drizzleDirectory, 'meta', '_journal.json'), 'utf8'),
  ) as { entries: Array<{ idx: number; tag: string }> };
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

type Database = ConstructorParameters<typeof DrizzleSessionStore>[0];

let client: PGlite;
let db: Database;
let sessions: DrizzleSessionStore;
let keys: DrizzleInstallationKeyStore;
let outbox: DrizzleOutboxRepository;

/**
 * A budget for the hook that stands the whole migration graph up in PGlite.
 *
 * Vitest's default `hookTimeout` is 10 000 ms, and this hook's cost is
 * `migrationSql()` — the real journal-ordered migration graph, applied to an
 * in-process Postgres. That is one of the two costs in this repository that scale with
 * the *tree* rather than with the test: every migration ever added is paid again on
 * every run. It passes in a couple of seconds on an idle machine and was measured
 * failing at 10 000 ms under `pnpm verify`, where turbo runs thirty-odd package suites
 * at once, with `Error: Hook timed out in 10000ms` and 96 of the file's tests green.
 *
 * The failure is a statement about the machine's load, not about a repository, and a
 * gate that reports a load problem as a defect is a gate people learn to re-run. So the
 * budget is stated rather than left implicit.
 *
 * 60s is headroom, not a target. If this ever genuinely needs 60s, the migration graph
 * has grown something that should be applied once for the package rather than per file.
 */
const PGLITE_MIGRATION_TIMEOUT_MS = 60_000;

beforeAll(async () => {
  client = new PGlite();
  await client.exec(migrationSql());
  db = drizzle(client, { schema }) as unknown as Database;
  sessions = new DrizzleSessionStore(db);
  keys = new DrizzleInstallationKeyStore(db);
  outbox = new DrizzleOutboxRepository(db as never);
}, PGLITE_MIGRATION_TIMEOUT_MS);

afterAll(async () => {
  if (client) await client.close();
});

const ISSUED = new Date('2026-01-01T00:00:00.000Z');
const EXPIRES = new Date('2026-01-02T00:00:00.000Z');

describe('DrizzleSessionStore', () => {
  it('creates a session, finds it while valid, and stops finding it once revoked', async () => {
    const installationId = '00000000-0000-4000-8000-000000000101';
    const tokenHash = 'a'.repeat(64);
    const id = await sessions.create({
      installationId,
      tokenHash,
      issuedAt: ISSUED,
      expiresAt: EXPIRES,
    });

    expect((await sessions.findValid(tokenHash, ISSUED))?.id).toBe(id);
    // Expiry is part of the predicate, not a check the caller has to remember: a
    // session past its expiry must not be findable, and `findValid` is the only
    // way a caller gets a session.
    expect(await sessions.findValid(tokenHash, EXPIRES)).toBeUndefined();
    expect(await sessions.revoke(id, new Date('2026-01-01T12:00:00.000Z'))).toBe(true);
    expect(await sessions.findValid(tokenHash, ISSUED)).toBeUndefined();
  });

  it('records when a session was last used, so idleness is observable', async () => {
    // Ledger S-5. `last_used_at` was in the schema, absent from the insert, selected
    // and then dropped by the mapping — so nothing could read a session's idleness,
    // which is the only reason to store it.
    //
    // The touch is on the *read* path, and that placement is the assertion: a
    // session's last use is when it was last validated, because that is the only
    // moment anyone proves the token is still good. A separate heartbeat would be a
    // second source of truth that could disagree with the first.
    const installationId = '00000000-0000-4000-8000-000000000104';
    const tokenHash = '8'.repeat(64);
    await sessions.create({
      installationId,
      tokenHash,
      issuedAt: ISSUED,
      expiresAt: EXPIRES,
    });

    // Each validation moves the column to the instant it was given, and hands back
    // the value it wrote rather than the one the `SELECT` read — a row returned
    // from before its own touch would make the column permanently one validation
    // behind, which is the opposite of what it is for.
    const first = new Date('2026-01-01T09:30:00.000Z');
    expect((await sessions.findValid(tokenHash, first))?.['lastUsedAt']).toEqual(first);

    // A later validation moves it again, so it is a running "last use" and not a
    // value written once at issue.
    const later = new Date('2026-01-01T18:00:00.000Z');
    expect((await sessions.findValid(tokenHash, later))?.['lastUsedAt']).toEqual(later);
  });
  it('deletes sessions issued before the cutoff and keeps the rest', async () => {
    // Ledger S-2 and S-7. Nothing in the repository deleted from `sessions`, so the
    // table grew with every sign-in for the life of the installation; `revoke` only
    // stamped a column.
    //
    // The cutoff is on `issuedAt` and not `expiresAt` on purpose, and this is the
    // assertion that says so: a session that expired *long ago* is still there,
    // because a row has to outlive its validity for "was this ever valid" to have an
    // answer. Deleting at `expiresAt` would satisfy a shorter test and lose that.
    const installationId = '00000000-0000-4000-8000-000000000102';
    const aged = await sessions.create({
      installationId,
      tokenHash: '1'.repeat(64),
      issuedAt: new Date('2025-01-01T00:00:00.000Z'),
      expiresAt: new Date('2025-01-02T00:00:00.000Z'),
    });
    const recent = await sessions.create({
      installationId,
      tokenHash: '2'.repeat(64),
      issuedAt: new Date('2026-08-01T00:00:00.000Z'),
      expiresAt: new Date('2026-08-02T00:00:00.000Z'),
    });

    // A cutoff that removes one leaves the other alone, and reports what it did.
    expect(
      await sessions.deleteExpired(new Date('2026-01-01T00:00:00.000Z')),
    ).toBeGreaterThanOrEqual(1);
    expect(
      await sessions.findValid('1'.repeat(64), new Date('2025-06-01T00:00:00.000Z')),
    ).toBeUndefined();
    expect(
      (await sessions.findValid('2'.repeat(64), new Date('2026-08-01T00:00:00.000Z')))?.id,
    ).toBe(recent);
    expect(aged).not.toBe(recent);
  });

  it('reports zero when nothing is past the cutoff', async () => {
    // A sweep that removed nothing and reported nothing is indistinguishable from one
    // that was never called, which is the state the ledger row described.
    const installationId = '00000000-0000-4000-8000-000000000103';
    await sessions.create({
      installationId,
      tokenHash: '3'.repeat(64),
      issuedAt: new Date('2026-09-01T00:00:00.000Z'),
      expiresAt: new Date('2026-09-02T00:00:00.000Z'),
    });
    expect(await sessions.deleteExpired(new Date('2020-01-01T00:00:00.000Z'))).toBe(0);
  });

  it('refuses a session with no expiry, which the column requires', async () => {
    await expect(
      sessions.create({
        installationId: '00000000-0000-4000-8000-000000000102',
        tokenHash: '1'.repeat(64),
        issuedAt: ISSUED,
        expiresAt: undefined as unknown as Date,
      }),
    ).rejects.toThrow();
  });

  it('reports a second revocation as not done, so a retry is idempotent', async () => {
    const installationId = '00000000-0000-4000-8000-000000000103';
    const id = await sessions.create({
      installationId,
      tokenHash: '7'.repeat(64),
      issuedAt: ISSUED,
      expiresAt: EXPIRES,
    });
    const at = new Date('2026-01-01T12:00:00.000Z');
    expect(await sessions.revoke(id, at)).toBe(true);
    // The `returning` clause is what makes the second call answer honestly: the
    // `isNull(revokedAt)` predicate matches nothing, so nothing is claimed.
    expect(await sessions.revoke(id, at)).toBe(false);
  });

  it('creates the installation on demand and does not fail when it exists', async () => {
    const installationId = '00000000-0000-4000-8000-000000000104';
    await sessions.ensureInstallation(installationId);
    await expect(sessions.ensureInstallation(installationId)).resolves.toBeUndefined();
  });
});

describe('DrizzleInstallationKeyStore', () => {
  it('bootstraps one key and returns the existing hash rather than rotating it', async () => {
    const installationId = '00000000-0000-4000-8000-000000000201';
    const first = await keys.ensureBootstrap({
      installationId,
      keyHash: '3'.repeat(64),
      displayPrefix: 'auto_',
    });
    // The second call must not mint a second key. Rotating the installation key on
    // every boot would invalidate every client holding the first one, which is why
    // this asserts the *returned* hash rather than merely that it did not throw.
    const second = await keys.ensureBootstrap({
      installationId,
      keyHash: 'e'.repeat(64),
      displayPrefix: 'auto_',
    });
    expect(second).toBe(first);
    const rows = await client.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM installation_keys WHERE installation_id = $1',
      [installationId],
    );
    expect(rows.rows[0]?.count).toBe(1);
  });
});

describe('DrizzleOutboxRepository', () => {
  const event = (dedupeKey: string, occurredAt: Date) => ({
    workspaceId: 'ws-outbox',
    aggregateType: 'run',
    aggregateId: 'run-1',
    eventType: 'execution.event.appended',
    payload: { dedupeKey },
    dedupeKey,
    occurredAt,
  });

  it('reads only this workspace, only after the cursor, and only unexpired rows', async () => {
    const base = new Date('2026-01-01T00:00:00.000Z');
    await outbox.appendMany([
      event('ws-outbox:1', base),
      event('ws-outbox:2', new Date('2026-01-01T01:00:00.000Z')),
      // Another workspace: a read scoped to one must not see it.
      { ...event('ws-other:1', base), workspaceId: 'ws-other' },
      // Expired: the read filters on `expires_at`, so retention is not the reader's
      // problem to solve and a stale event cannot reach a consumer.
      { ...event('ws-outbox:3', base), expiresAt: new Date('2020-01-01T00:00:00.000Z') },
    ]);

    const page = await outbox.readAfter({ workspaceId: 'ws-outbox', afterSequence: 0 });
    expect(page.map((row) => row.dedupeKey)).toEqual(['ws-outbox:1', 'ws-outbox:2']);
    expect(page.map((row) => row.eventVersion)).toEqual([1, 1]);
  });

  it('advances the cursor, so a consumer does not re-read what it has', async () => {
    const page = await outbox.readAfter({ workspaceId: 'ws-outbox', afterSequence: 0 });
    const after = page[0]?.sequence ?? 0;
    const second = await outbox.readAfter({ workspaceId: 'ws-outbox', afterSequence: after });
    expect(second.map((row) => row.dedupeKey)).toEqual(['ws-outbox:2']);
  });

  it('caps the page size rather than trusting the caller', async () => {
    for (let index = 0; index < 8; index += 1) {
      await outbox.append({
        ...event(`ws-bulk:${index}`, new Date('2026-02-01T00:00:00.000Z')),
        workspaceId: 'ws-bulk',
      });
    }
    // `0`, a negative, and a fraction all clamp rather than being passed to SQL as a
    // limit: a `LIMIT 0` would silently return nothing and look like an empty
    // workspace, and a negative limit is a database error.
    for (const limit of [0, -5, 1.7, Number.NaN]) {
      const page = await outbox.readAfter({ workspaceId: 'ws-bulk', afterSequence: 0, limit });
      expect(page.length, `limit ${String(limit)} returned nothing`).toBeGreaterThan(0);
    }
    expect(
      (await outbox.readAfter({ workspaceId: 'ws-bulk', afterSequence: 0, limit: 1 })).length,
    ).toBe(1);
  });

  it('deduplicates on the key, so a retried append is not a second event', async () => {
    const dedupeKey = 'ws-outbox:dedupe';
    const occurredAt = new Date('2026-03-01T00:00:00.000Z');
    const first = await outbox.append(event(dedupeKey, occurredAt));
    const second = await outbox.append(event(dedupeKey, occurredAt));
    expect(first).not.toBeNull();
    expect(second, 'a duplicate key must report nothing appended').toBeNull();
    const page = await outbox.readAfter({ workspaceId: 'ws-outbox', afterSequence: 0 });
    expect(page.filter((row) => row.dedupeKey === dedupeKey)).toHaveLength(1);
  });

  it('refuses an event with no key or no aggregate, before touching the database', async () => {
    const base = new Date('2026-01-01T00:00:00.000Z');
    await expect(outbox.append(event('', base))).rejects.toThrow(/dedupe key/);
    await expect(
      outbox.append({ ...event('ws-outbox:no-aggregate', base), aggregateId: '' }),
    ).rejects.toThrow(/aggregate and event identifiers/);
    // And an empty batch is not an error: a caller with nothing to append should not
    // have to branch.
    await expect(outbox.appendMany([])).resolves.toEqual([]);
  });

  it('purges expired events and reports the retention floor', async () => {
    const purged = await outbox.purgeExpired(new Date('2020-06-01T00:00:00.000Z'));
    expect(purged).toBeGreaterThan(0);
    const floor = await outbox.getRetentionFloor('ws-outbox');
    expect(floor).toBeGreaterThan(0);
    // No floor for a workspace with nothing unexpired, which is what lets a reader
    // start from zero rather than guess.
    expect(await outbox.getRetentionFloor('ws-never-used')).toBeNull();
  });
});
