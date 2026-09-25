// Migration runner using drizzle-kit migrator
// Run this file with: node dist/migrate.js
// Requires DATABASE_URL environment variable to be set.

import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Runs all pending Drizzle migrations from the drizzle/ folder.
 * Uses the __drizzle_migrations table to track applied migrations.
 */
export async function runMigrations(connectionString?: string): Promise<void> {
  const url = connectionString ?? process.env['DATABASE_URL'];
  if (!url) {
    throw new Error('DATABASE_URL environment variable is required for migrations');
  }

  const pool = new pg.Pool({ connectionString: url });
  const db = drizzle(pool);

  const migrationsFolder = join(__dirname, '..', 'drizzle');

  try {
    await migrate(db, { migrationsFolder });
    console.info('Migrations completed successfully');
  } finally {
    await pool.end();
  }
}

// CLI entrypoint: run if this file is invoked directly
const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  runMigrations().catch((err: unknown) => {
    console.error('Migration failed:', (err as Error).message);
    process.exit(1);
  });
}
