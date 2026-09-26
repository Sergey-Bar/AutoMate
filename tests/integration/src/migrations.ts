import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

/**
 * Applies the real migration graph to a PGlite instance.
 *
 * The only integration test used to hand-write three `CREATE TABLE` statements.
 * That meant none of the seven migrations in `packages/db/drizzle` were ever
 * executed by any test, so a migration that no longer matched the Drizzle
 * schema — a renamed column, a dropped constraint, a column the code writes but
 * the database lacks — was undetectable until it reached a deployment.
 *
 * This runner reads the migrations in the order `meta/_journal.json` declares
 * (not alphabetical order, which happens to differ) and applies them through
 * PGlite, which is the same SQL engine the production Postgres is.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const drizzleDirectory = path.resolve(here, '../../../packages/db/drizzle');
const journalPath = path.join(drizzleDirectory, 'meta', '_journal.json');

/** One migration, in journal order. */
export interface Migration {
  index: number;
  tag: string;
  sql: string;
}

/**
 * The migration graph, ordered by the journal.
 *
 * Ordering matters and is not alphabetical: `0002_phase3_key_constraint` and
 * `0004_orange_hellfire_club` depend on objects created by `0001` and `0003`
 * respectively. Reading the directory listing would apply them in the wrong
 * order for any future migration whose tag sorts before its dependency.
 */
export function readMigrations(): Migration[] {
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
    entries: Array<{ idx: number; tag: string }>;
  };
  const missing: string[] = [];
  const migrations = journal.entries
    .slice()
    .sort((left, right) => left.idx - right.idx)
    .map((entry) => {
      const file = path.join(drizzleDirectory, `${entry.tag}.sql`);
      try {
        return { index: entry.idx, tag: entry.tag, sql: readFileSync(file, 'utf8') };
      } catch {
        missing.push(entry.tag);
        return null;
      }
    })
    .filter((migration): migration is Migration => migration !== null);
  if (missing.length > 0) {
    // A migration the journal names but the directory lacks would otherwise be
    // skipped silently, and the test would pass against a partial schema.
    throw new Error(`Migration files missing for journal entries: ${missing.join(', ')}`);
  }
  const onDisk = readdirSync(drizzleDirectory).filter(
    (file) =>
      file.endsWith('.sql') && !migrations.some((migration) => `${migration.tag}.sql` === file),
  );
  if (onDisk.length > 0) {
    // A migration with no journal entry is never applied by any deploy either,
    // so its SQL is dead. Report it rather than letting it pass unnoticed.
    throw new Error(
      `Migration files with no journal entry, so no deploy would run them: ${onDisk.join(', ')}`,
    );
  }
  return migrations;
}

/** Splits a migration file on Drizzle's statement separator. */
function statements(migration: Migration): string[] {
  return migration.sql
    .split('--> statement-breakpoint')
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

/** Applies the whole graph, returning the tags applied. */
export async function applyMigrations(client: PGlite): Promise<string[]> {
  const applied: string[] = [];
  for (const migration of readMigrations()) {
    for (const statement of statements(migration)) {
      await client.exec(statement);
    }
    applied.push(migration.tag);
  }
  return applied;
}

/** A PGlite instance with the real schema applied. */
export async function createMigratedDatabase(): Promise<PGlite> {
  const client = new PGlite();
  await applyMigrations(client);
  return client;
}

/**
 * Fails when `packages/db` has not been rebuilt since its source changed.
 *
 * `@automate/db` resolves to `dist/`, so the schema these tests compare against
 * the migrations is whatever was last built. A bare `npx vitest` run bypasses
 * turbo's `test.dependsOn: ["^build"]`, so it can resolve a stale build — and a
 * drift test that silently compares yesterday's schema passes without checking
 * anything, which is worse than having no drift test.
 */
export function assertSchemaBuildIsFresh(): void {
  const packageRoot = path.resolve(drizzleDirectory, '..');
  const buildOutput = path.join(packageRoot, 'dist', 'index.js');
  const guidance =
    'These assertions compare the migrations against the built schema. Use ' +
    'pnpm test (turbo builds dependencies first), or run ' +
    'pnpm --filter @automate/db build. A bare npx vitest run resolves ' +
    '@automate/db to whatever was last built.';
  let buildTime: number;
  try {
    buildTime = statSync(buildOutput).mtimeMs;
  } catch {
    throw new Error(`${buildOutput} does not exist. ${guidance}`);
  }
  const stale = listSourceFiles(path.join(packageRoot, 'src'))
    .map((file) => ({ file, mtime: statSync(file).mtimeMs }))
    .filter(({ mtime }) => mtime > buildTime)
    .map(({ file }) => path.relative(packageRoot, file).replaceAll('\\', '/'))
    .sort();
  if (stale.length > 0) {
    throw new Error(
      `packages/db is not built: ${stale.length} source file(s) are newer than dist/. ` +
        `Newest: ${stale[0]}. ${guidance}`,
    );
  }
}

function listSourceFiles(root: string): string[] {
  const found: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) found.push(full);
    }
  }
  return found;
}

/** Column names for a table, from the live catalogue. */
export async function columnNames(client: PGlite, table: string): Promise<string[]> {
  const result = await client.query<{ column_name: string }>(
    'SELECT column_name FROM information_schema.columns WHERE table_name = $1 ORDER BY column_name',
    [table],
  );
  return result.rows.map((row) => row.column_name);
}

/** Constraint names defined on a table. */
export async function constraintNames(client: PGlite, table: string): Promise<string[]> {
  const result = await client.query<{ conname: string }>(
    'SELECT conname FROM pg_constraint WHERE conrelid = $1::regclass ORDER BY conname',
    [table],
  );
  return result.rows.map((row) => row.conname);
}

/** Table names present in the public schema. */
export async function tableNames(client: PGlite): Promise<string[]> {
  const result = await client.query<{ table_name: string }>(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name",
  );
  return result.rows.map((row) => row.table_name);
}

/**
 * The values a `CHECK` constraint permits for a column, read from the live
 * catalogue.
 *
 * The Drizzle `enum` on a `text` column is compile-time only, so a test that
 * compared it against a restated list would prove nothing. This reads the
 * constraint PostgreSQL actually enforces.
 */
export async function readMigrationStateValues(
  client: PGlite,
  table: string,
  column: string,
): Promise<string[]> {
  const result = await client.query<{ pg_get_constraintdef: string }>(
    `SELECT pg_get_constraintdef(c.oid) AS pg_get_constraintdef
       FROM pg_constraint c
       JOIN pg_class t ON t.oid = c.conrelid
      WHERE t.relname = $1 AND c.conname = $2`,
    [table, `${table}_${column}_check`],
  );
  const definition = result.rows[0]?.pg_get_constraintdef;
  if (definition === undefined) {
    throw new Error(`${table}_${column}_check not found; the constraint is not enforced`);
  }
  return [...definition.matchAll(/'([a-z_]+)'/g)]
    .map((match) => match[1])
    .filter((value): value is string => value !== undefined);
}
