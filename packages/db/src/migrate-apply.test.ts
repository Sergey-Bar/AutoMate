import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type pg from 'pg';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { listMigrationFiles, MIGRATION_ADVISORY_LOCK_KEY, runMigrations } from './migrate.js';

/**
 * `runMigrations` end to end through Drizzle's real migrator, against a pool that
 * keeps a journal in memory.
 *
 * `migrate.test.ts` only ever points the runner at a folder with no journal, so
 * every apply it observes is one that failed before Drizzle ran. These tests give
 * it a real migrations folder and check the part the runner itself computes: which
 * hashes were applied by *this* call, which were already there, and that the
 * journal-consistency refusal happens before any migration SQL is sent.
 */

const VALID_URL = 'postgresql://user:pass@db.internal:5432/automate';
const LOCK_KEY = MIGRATION_ADVISORY_LOCK_KEY.toString();

const pgMock = vi.hoisted(() => ({ constructed: [] as unknown[], pool: null as unknown }));

vi.mock('pg', async (importOriginal) => {
  const actual = await importOriginal<{ default: typeof pg }>();
  function Pool(config: unknown) {
    pgMock.constructed.push(config);
    return pgMock.pool;
  }
  return { ...actual, default: { ...actual.default, Pool } };
});

interface JournalRow {
  id: number;
  hash: string;
  created_at: number;
}

type QueryInput = string | { text: string; values?: unknown[] };

/** A pool whose only state is the migration journal, and a log of what it was sent. */
function journalPool(initial: readonly Omit<JournalRow, 'id'>[] = []) {
  const journal: JournalRow[] = initial.map((row, index) => ({ id: index + 1, ...row }));
  const statements: string[] = [];
  const events: string[] = [];
  const failures: { lock?: Error; unlock?: Error } = {};

  async function query(input: QueryInput, params?: unknown[]) {
    const text = typeof input === 'string' ? input : input.text;
    const values = (typeof input === 'string' ? params : (input.values ?? params)) ?? [];
    statements.push(text);
    if (text.includes('pg_advisory_lock')) {
      events.push(`lock:${String(values[0])}`);
      if (failures.lock) throw failures.lock;
      return { rows: [], rowCount: 0, fields: [] };
    }
    if (text.includes('pg_advisory_unlock')) {
      events.push(`unlock:${String(values[0])}`);
      if (failures.unlock) throw failures.unlock;
      return { rows: [], rowCount: 0, fields: [] };
    }
    if (/insert into "drizzle"\."__drizzle_migrations"/i.test(text)) {
      journal.push({
        id: journal.length + 1,
        hash: String(values[0]),
        created_at: Number(values[1]),
      });
      return { rows: [], rowCount: 1, fields: [] };
    }
    if (/from "?drizzle"?\."?__drizzle_migrations"?/i.test(text)) {
      const ordered = [...journal].sort((left, right) => left.created_at - right.created_at);
      const rows = /desc limit 1/i.test(text) ? ordered.slice(-1) : ordered;
      return { rows, rowCount: rows.length, fields: [] };
    }
    return { rows: [], rowCount: 0, fields: [] };
  }

  const client = { query, release: () => events.push('release') };
  const pool = {
    connect: async () => client,
    query,
    end: async () => events.push('end'),
  } as unknown as pg.Pool;
  return { pool, journal, statements, events, failures };
}

let folder: string;
const MIGRATION_SQL =
  'CREATE TABLE "widgets" ("id" integer PRIMARY KEY);\n--> statement-breakpoint\nCREATE INDEX "widgets_id_idx" ON "widgets" ("id");';
const MIGRATION_HASH = createHash('sha256').update(MIGRATION_SQL).digest('hex');
const MIGRATION_WHEN = 1_700_000_000_000;

beforeEach(() => {
  folder = mkdtempSync(path.join(tmpdir(), 'automate-db-migrations-'));
  mkdirSync(path.join(folder, 'meta'));
  writeFileSync(
    path.join(folder, 'meta', '_journal.json'),
    JSON.stringify({
      version: '7',
      dialect: 'postgresql',
      entries: [
        { idx: 0, version: '7', when: MIGRATION_WHEN, tag: '0000_widgets', breakpoints: true },
      ],
    }),
  );
  writeFileSync(path.join(folder, '0000_widgets.sql'), MIGRATION_SQL);
  pgMock.constructed.length = 0;
  pgMock.pool = null;
});

afterEach(() => {
  rmSync(folder, { recursive: true, force: true });
});

describe('runMigrations against a migrations folder', () => {
  it('applies a pending migration and reports exactly that hash as applied', async () => {
    const fake = journalPool();
    const result = await runMigrations(VALID_URL, { pool: fake.pool, folder });

    expect(result.applied).toEqual([MIGRATION_HASH]);
    expect(result.alreadyCurrent).toEqual([]);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(fake.journal.map((row) => [row.hash, row.created_at])).toEqual([
      [MIGRATION_HASH, MIGRATION_WHEN],
    ]);
    // Both statements of the migration reached the database.
    expect(fake.statements.some((text) => text.includes('CREATE TABLE "widgets"'))).toBe(true);
    expect(fake.statements.some((text) => text.includes('CREATE INDEX "widgets_id_idx"'))).toBe(
      true,
    );
    expect(fake.events).toEqual([`lock:${LOCK_KEY}`, `unlock:${LOCK_KEY}`, 'release']);
  });

  it('applies nothing on a database that is already current, and says so', async () => {
    const fake = journalPool([{ hash: MIGRATION_HASH, created_at: MIGRATION_WHEN }]);
    const result = await runMigrations(VALID_URL, { pool: fake.pool, folder });

    expect(result.applied).toEqual([]);
    expect(result.alreadyCurrent).toEqual([MIGRATION_HASH]);
    expect(fake.statements.some((text) => text.includes('CREATE TABLE "widgets"'))).toBe(false);
    expect(fake.journal).toHaveLength(1);
  });

  it('refuses before sending any migration SQL when the journal is ahead of the folder', async () => {
    const fake = journalPool([
      { hash: 'a'.repeat(64), created_at: 1 },
      { hash: 'b'.repeat(64), created_at: 2 },
    ]);
    await expect(runMigrations(VALID_URL, { pool: fake.pool, folder })).rejects.toThrow(
      'The database journal records 2 migrations but this checkout contains 1.',
    );
    expect(fake.statements.some((text) => text.includes('widgets'))).toBe(false);
    expect(fake.journal).toHaveLength(2);
    // The refusal is inside the lock, and the lock is still released.
    expect(fake.events).toEqual([`lock:${LOCK_KEY}`, `unlock:${LOCK_KEY}`, 'release']);
  });

  it('does not try to release a lock it never took, but still returns the client', async () => {
    const fake = journalPool();
    fake.failures.lock = new Error('canceling statement due to lock timeout');
    await expect(runMigrations(VALID_URL, { pool: fake.pool, folder })).rejects.toThrow(
      'canceling statement due to lock timeout',
    );
    expect(fake.events).toEqual([`lock:${LOCK_KEY}`, 'release']);
    expect(fake.statements.some((text) => text.includes('widgets'))).toBe(false);
  });

  it('reports a successful apply even when releasing the lock fails', async () => {
    // The session ends shortly after and Postgres drops the lock with it, so an
    // unlock error must not turn an applied migration into a reported failure.
    const fake = journalPool();
    fake.failures.unlock = new Error('connection terminated');
    const result = await runMigrations(VALID_URL, { pool: fake.pool, folder });
    expect(result.applied).toEqual([MIGRATION_HASH]);
    expect(fake.events).toEqual([`lock:${LOCK_KEY}`, `unlock:${LOCK_KEY}`, 'release']);
  });

  it('opens its own pool from the trimmed URL when none is given, and ends it', async () => {
    const fake = journalPool();
    pgMock.pool = fake.pool;
    const result = await runMigrations(`  ${VALID_URL}  `, { folder });
    expect(pgMock.constructed).toEqual([{ connectionString: VALID_URL }]);
    expect(result.applied).toEqual([MIGRATION_HASH]);
    expect(fake.events.at(-1)).toBe('end');
  });

  it('ends its own pool when the apply fails', async () => {
    const fake = journalPool();
    fake.failures.lock = new Error('too many connections');
    pgMock.pool = fake.pool;
    await expect(runMigrations(VALID_URL, { folder })).rejects.toThrow('too many connections');
    expect(fake.events).toEqual([`lock:${LOCK_KEY}`, 'release', 'end']);
  });
});

describe('listMigrationFiles', () => {
  it('returns nothing for a folder that does not exist rather than throwing', () => {
    expect(listMigrationFiles(path.join(folder, 'absent'))).toEqual([]);
  });

  it('lists only .sql files, sorted, and ignores the meta directory', () => {
    writeFileSync(path.join(folder, '0001_more.sql'), 'SELECT 1;');
    writeFileSync(path.join(folder, 'README.md'), 'not a migration');
    expect(listMigrationFiles(folder)).toEqual(['0000_widgets.sql', '0001_more.sql']);
  });
});
