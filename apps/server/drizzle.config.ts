import { defineConfig } from 'drizzle-kit';

/**
 * Drizzle Kit configuration.
 *
 * Migration workflow:
 *   pnpm db:generate   — diff schema → produce new SQL file in drizzle/
 *   pnpm db:migrate    — apply pending migrations to the database
 *   pnpm db:push       — (dev shortcut) push schema directly, no migration file
 *
 * Production / Docker: set AUTO_MIGRATE=true to run migrations on startup,
 * or run `pnpm db:migrate` before starting the server.
 */
export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://localhost:5432/automate',
  },
});
