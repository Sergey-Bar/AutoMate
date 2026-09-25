// PostgreSQL client helper using drizzle-orm/node-postgres
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema/index.js';

export type DbClient = ReturnType<typeof createDbClient>;

/**
 * Creates a Drizzle ORM client connected to PostgreSQL.
 * @param connectionString - PostgreSQL connection URL (e.g. postgresql://user:pass@host:5432/db)
 */
export function createDbClient(connectionString: string) {
  const pool = new pg.Pool({ connectionString });
  return drizzle(pool, { schema });
}
