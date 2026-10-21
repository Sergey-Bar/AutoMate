import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { PostgresExecutionStore } from '../postgres-store.js';
import type { ExecutionStoreOptions } from '../types.js';

/**
 * Test support: `PostgresExecutionStore` against the **real** migration graph.
 *
 * Imported only by `*.test.ts`. The rest of this package stubs `pg.Pool#query` and
 * asserts on SQL text, which cannot see what a statement leaves in a row; a store built
 * here runs every statement against PGlite with every migration applied, so a test can
 * read the database back.
 */

const DRIZZLE = path.resolve(import.meta.dirname, '../../../../packages/db/drizzle');

/** Every migration, in journal order, as one script. */
export function migrationSql(): string {
  const journal = JSON.parse(readFileSync(path.join(DRIZZLE, 'meta', '_journal.json'), 'utf8')) as {
    entries: Array<{ idx: number; tag: string }>;
  };
  return journal.entries
    .slice()
    .sort((left, right) => left.idx - right.idx)
    .map((entry) =>
      readFileSync(path.join(DRIZZLE, `${entry.tag}.sql`), 'utf8')
        .split('--> statement-breakpoint')
        .map((statement) => statement.trim())
        .filter(Boolean)
        .join(';\n'),
    )
    .join(';\n');
}

/** A fresh in-process database with the whole migration graph applied. */
export async function migratedDatabase(): Promise<PGlite> {
  const database = new PGlite();
  await database.exec(migrationSql());
  return database;
}

/**
 * A store whose pool is PGlite. pg connects lazily, so the real pool built by the
 * constructor never opens a socket, and replacing it is the one seam the class has.
 *
 * `rowCount` is mapped from PGlite's `affectedRows`: the store's compare-and-set
 * methods (`renewLease`, `advanceSchedule`) answer from it, and without the mapping
 * they would report `false` for every write that succeeded.
 */
export function storeOnPglite(
  database: PGlite,
  options: ExecutionStoreOptions = {},
): PostgresExecutionStore {
  const store = new PostgresExecutionStore('postgres://unused/unused', options);
  const query = async (text: string, values?: unknown[]) => {
    const result = await database.query(text, values ?? []);
    return { rows: result.rows, rowCount: result.affectedRows ?? 0 };
  };
  const client = { query, release: () => undefined };
  (store as unknown as { pool: unknown }).pool = {
    connect: () => Promise.resolve(client),
    query,
    end: () => Promise.resolve(),
  };
  return store;
}
