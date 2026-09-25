import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema.js';

const connectionString =
  process.env.DATABASE_URL ?? 'postgresql://localhost:5432/dashboard';

export const pool = new Pool({ connectionString });

export const db = drizzle(pool, { schema });
type _DB = typeof db;

export const isPostgres = !process.env.VITEST;

// Exported for health endpoint and graceful shutdown
const poolProxy = new Proxy(pool, {
  get(target, prop, receiver) {
    if (prop === 'close') {
      return () => target.end();
    }
    // Duck-type for better-sqlite3 in health checks or legacy code
    if (prop === 'prepare') {
      return (sql: string) => ({
        get: () => {
          throw new Error(`prepare().get() not supported on Postgres pool: ${sql}`);
        },
        run: () => {
          throw new Error(`prepare().run() not supported on Postgres pool: ${sql}`);
        },
        all: () => {
          throw new Error(`prepare().all() not supported on Postgres pool: ${sql}`);
        },
      });
    }
    return Reflect.get(target, prop, receiver);
  },
});

export { poolProxy as sqlite, pool as poolConnection };
