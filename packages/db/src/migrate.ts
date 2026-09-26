// Migration runner using drizzle-kit migrator
// Run this file with: node dist/migrate.js
// Requires DATABASE_URL environment variable to be set.

import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { realpathSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * The advisory lock key every migration apply contends on.
 *
 * Two instances starting at once — a rolling deploy, or a CI job racing a local
 * run — will both read the journal, both see the same pending migrations, and
 * both try to apply them. Drizzle records what it applied, but it does not stop
 * two callers from being inside `migrate()` at the same moment, and the loser
 * either throws on a duplicate DDL statement or, worse, half-applies and reports
 * success.
 *
 * A session-level advisory lock is the one primitive that is already in Postgres,
 * is scoped to the connection rather than the database, and is released
 * automatically when the session ends — including when it ends because the
 * process was killed mid-migration, which a lock table row would not be.
 *
 * The number is arbitrary but must not collide with another caller in this
 * database. The ASCII of "automate/migrate", as a signed 64-bit integer.
 */
export const MIGRATION_ADVISORY_LOCK_KEY = 8_103_517_082_377_401n;

/** The schemas a migration target is allowed to use. */
const POSTGRES_PROTOCOLS = new Set(['postgres:', 'postgresql:']);

/**
 * Validates a migration target before a connection is attempted.
 *
 * `new pg.Pool({ connectionString })` does not validate anything: an unset
 * `DATABASE_URL` becomes the `PG*` environment defaults, which on a developer
 * machine usually point at *something*, and a mistyped URL becomes a connection
 * refused several seconds later with no indication of which of the two happened.
 * A migration runner that cannot say which database it is about to change should
 * not change one.
 *
 * @param {string | undefined} connectionString
 * @returns {{ host: string, database: string }}
 * @throws when the URL is absent, unparseable, not a Postgres URL, or names no database
 */
export function assertMigrationDatabaseUrl(connectionString: string | undefined): {
  host: string;
  database: string;
} {
  const raw = connectionString?.trim() ?? '';
  if (raw === '') {
    throw new Error(
      'DATABASE_URL is required for migrations. It was absent, so the runner ' +
        'would have fallen back to the PG* environment defaults and reported ' +
        'success against whichever database those point at.',
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(
      `DATABASE_URL is not a valid URL: ${JSON.stringify(raw)}. Expected ` +
        'postgresql://user:password@host:5432/database',
    );
  }
  if (!POSTGRES_PROTOCOLS.has(parsed.protocol)) {
    throw new Error(`DATABASE_URL must use postgres:// or postgresql://, not ${parsed.protocol}`);
  }
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (database === '') {
    throw new Error(
      'DATABASE_URL names no database. Migrations would run against the ' +
        "connection's default, which is not something to change by accident.",
    );
  }
  return { host: parsed.hostname, database };
}

/**
 * Is this module the process entry point?
 *
 * The previous check was `process.argv[1] === fileURLToPath(import.meta.url)`, a
 * literal string comparison that is false on Windows (the drive letter and
 * separator both differ) and false for any bin reached through a symlink, which
 * is how every `pnpm exec` and every global install resolves. A false negative
 * here is the worst kind of bug in a CLI: the process exits 0 having done
 * nothing at all, and a deployment step that applies migrations reports success.
 *
 * Comparing canonical `file:` URLs after resolving symlinks is the form that
 * holds on every platform.
 *
 * @param {string | undefined} entry `process.argv[1]`
 * @param {string} moduleUrl `import.meta.url`
 */
export function isDirectInvocation(entry: string | undefined, moduleUrl: string): boolean {
  if (entry === undefined || entry === '') return false;
  try {
    return pathToFileURL(realpathSync(entry)).href === moduleUrl;
  } catch {
    // The entry does not exist on disk (an eval'd module, a loader shim). It
    // cannot be the file this module was loaded from.
    return false;
  }
}

/** The `drizzle` migrations folder, resolved next to the compiled module. */
export function migrationsFolderFor(moduleDirectory: string): string {
  return join(moduleDirectory, '..', 'drizzle');
}

/**
 * What an apply actually did.
 *
 * The runner used to log `Migrations completed successfully` unconditionally,
 * whether it applied four migrations or none because the database was already
 * current. Those are different facts and a deployment log that cannot tell them
 * apart is not evidence that a migration ran.
 */
export interface MigrationApplyResult {
  applied: string[];
  alreadyCurrent: string[];
  durationMs: number;
}

/**
 * Runs all pending Drizzle migrations from the drizzle/ folder.
 * Uses the __drizzle_migrations table to track applied migrations.
 *
 * @param connectionString defaults to `DATABASE_URL`
 * @param options.folder overrides the migrations folder, for tests
 * @returns exactly which migrations this call applied
 */
export async function runMigrations(
  connectionString?: string,
  options: { folder?: string; pool?: pg.Pool } = {},
): Promise<MigrationApplyResult> {
  // Throws on a malformed or non-local database URL. The host and name it returns
  // are not needed here — the call is the check — so they are not destructured
  // into two variables that then read as unused.
  assertMigrationDatabaseUrl(connectionString);
  const startedAt = process.hrtime.bigint();
  const pool = options.pool ?? new pg.Pool({ connectionString: connectionString?.trim() });
  const db = drizzle(pool);
  const migrationsFolder = options.folder ?? migrationsFolderFor(__dirname);

  try {
    // A dedicated client, because the lock is session-scoped: it must be taken
    // and released on the same connection or it protects nothing.
    const client = await pool.connect();
    let locked = false;
    try {
      await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_ADVISORY_LOCK_KEY.toString()]);
      locked = true;
      const before = await readJournal(client);
      const inconsistency = describeJournalInconsistency(
        before,
        listMigrationFiles(migrationsFolder),
      );
      if (inconsistency !== null) throw new Error(inconsistency);
      await migrate(db, { migrationsFolder });
      const after = await readJournal(client);
      const applied = after.filter((entry) => !before.includes(entry));
      return {
        applied,
        alreadyCurrent: before,
        durationMs: Number(process.hrtime.bigint() - startedAt) / 1e6,
      };
    } finally {
      if (locked) {
        // Best effort: a failure here must not mask a migration error, and the
        // lock is released anyway when the session ends.
        await client
          .query('SELECT pg_advisory_unlock($1)', [MIGRATION_ADVISORY_LOCK_KEY.toString()])
          .catch(() => undefined);
      }
      client.release();
    }
  } finally {
    if (options.pool === undefined) await pool.end();
  }
}

/** Migration hashes already recorded in the journal, oldest first. */
async function readJournal(client: pg.PoolClient): Promise<string[]> {
  const result = await client.query<{ hash: string; created_at: number }>(
    'SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at',
  );
  return result.rows.map((row) => row.hash);
}

/**
 * Does the database's journal describe the same set of migrations as this
 * checkout's folder?
 *
 * A journal with more entries than there are files means the database has
 * migrations this checkout does not have — a rollback to an older commit, or a
 * partial restore. Applying on top of that silently reorders history: the
 * runner sees "nothing pending" for the migrations it does have, and the
 * database keeps columns and tables the running application believes were
 * dropped.
 *
 * Fewer journal entries than files is the ordinary case of a pending migration
 * and is not an inconsistency.
 *
 * @param journalHashes entries recorded in the database
 * @param migrationFiles `.sql` file names in the migrations folder
 * @returns a message describing the inconsistency, or null when consistent
 */
export function describeJournalInconsistency(
  journalHashes: string[],
  migrationFiles: string[],
): string | null {
  if (journalHashes.length <= migrationFiles.length) return null;
  return (
    `The database journal records ${journalHashes.length} migrations but this ` +
    `checkout contains ${migrationFiles.length}. The database has migrations this ` +
    'build does not, so the schema and the code disagree. Restore the matching ' +
    'branch or forward-port the missing migrations before applying anything.'
  );
}

/** The `.sql` migrations in a folder, in journal-name order. */
export function listMigrationFiles(folder: string): string[] {
  if (!existsSync(folder)) return [];
  return readdirSync(folder)
    .filter((name) => name.endsWith('.sql'))
    .sort();
}

/** CLI entrypoint: run if this file is invoked directly. */
if (isDirectInvocation(process.argv[1], import.meta.url)) {
  runMigrations()
    .then((result) => {
      if (result.applied.length === 0) {
        console.info(
          `Migrations: already current (${result.alreadyCurrent.length} recorded, ` +
            `nothing to apply) on ${assertMigrationDatabaseUrl(process.env['DATABASE_URL']).database}.`,
        );
        return;
      }
      console.info(
        `Migrations: applied ${result.applied.length} to ` +
          `${assertMigrationDatabaseUrl(process.env['DATABASE_URL']).database} in ` +
          `${result.durationMs.toFixed(0)}ms`,
      );
      for (const hash of result.applied) console.info(`  applied ${hash}`);
    })
    .catch((err: unknown) => {
      console.error('Migration failed:', (err as Error).message);
      process.exit(1);
    });
}
