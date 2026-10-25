import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from '@automate/db';

const here = path.dirname(fileURLToPath(import.meta.url));
const drizzleDirectory = path.resolve(here, '../../../../packages/db/drizzle');

/** Every migration in journal order, as one script PGlite runs in a single `exec`. */
export function migrationSql(): string {
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

export type MigratedDb = ReturnType<typeof drizzle<typeof schema>>;

/**
 * An in-process PostgreSQL with the real migration graph applied and two workspaces,
 * `ws-1` and `ws-2`, so a test can write in one and prove the other cannot see it.
 */
export async function migratedDatabase(): Promise<{ db: MigratedDb; close: () => Promise<void> }> {
  const client = new PGlite();
  await client.exec(migrationSql());
  const db = drizzle(client, { schema });
  for (const id of ['ws-1', 'ws-2']) {
    await db
      .insert(schema.workspaces)
      .values({ id, name: id, configPath: '.', createdAt: new Date() });
  }
  return { db, close: () => client.close() };
}
