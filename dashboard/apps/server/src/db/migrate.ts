import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { db } from './client.js';

// Resolve migrations folder relative to this file so it works in both
// src/ (tsx dev) and dist/ (compiled) contexts.
// src/db/migrate.ts   → ../../drizzle = apps/server/drizzle/
// dist/db/migrate.js  → ../../drizzle = apps/server/drizzle/
const _dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_FOLDER = join(_dirname, '../../drizzle');

/**
 * Run Drizzle Kit SQL migrations from the drizzle/ folder.
 *
 * Idempotent — Drizzle tracks applied migrations in the `__drizzle_migrations`
 * table and only applies files that have not been run yet.
 *
 * Use this in production / Docker (set AUTO_MIGRATE=true) or run
 * `pnpm db:migrate` from apps/server/ before starting the server.
 */
export async function runDrizzleMigrations(): Promise<void> {
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
}
