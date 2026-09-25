/**
 * Health endpoints for Kubernetes / Docker probes.
 *
 * /health/live    — liveness:  is the process alive?
 * /health/ready   — readiness: is the service ready to serve (DB connected)?
 * /health/startup — startup:   has initialization completed?
 * /health         — legacy alias kept for existing clients
 */
import type { FastifyInstance } from 'fastify';

/** Duck-typed interface that works with both pg.Pool and better-sqlite3 Database */
export interface DbConnection {
  query?: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
  prepare?: (sql: string) => { get: () => unknown };
  end?: () => Promise<void>;
  close?: () => void;
}

export interface HealthRoutesOptions {
  sqlite: DbConnection;
  version: string;
}

interface DbCheck {
  connected: boolean;
  tables?: number;
  error?: string;
}

async function checkDatabase(conn: DbConnection): Promise<DbCheck> {
  try {
    // pg.Pool path
    if (typeof conn.query === 'function') {
      const result = await conn.query(
        "SELECT count(*) AS cnt FROM information_schema.tables WHERE table_schema = 'public'",
      );
      const rows = (result as { rows: Array<{ cnt: string | number }> }).rows;
      return { connected: true, tables: Number(rows[0]?.cnt ?? 0) };
    }
    // better-sqlite3 path (test environment)
    if (typeof conn.prepare === 'function') {
      const row = conn.prepare(
        "SELECT count(*) AS cnt FROM sqlite_master WHERE type='table'",
      ).get() as { cnt: number };
      return { connected: true, tables: row.cnt };
    }
    return { connected: true, tables: 0 };
  } catch (err) {
    return { connected: false, error: (err as Error).message };
  }
}

export async function healthRoutes(
  app: FastifyInstance,
  opts: HealthRoutesOptions,
): Promise<void> {
  const { sqlite: conn, version } = opts;

  // Liveness probe — returns 200 when the process is alive (RELY-04)
  app.get('/health/live', async () => ({
    status: 'ok',
  }));

  // Readiness probe — returns 200 only when DB is reachable (RELY-05)
  app.get('/health/ready', async (_req, reply) => {
    const db = await checkDatabase(conn);
    const status = db.connected ? 'ok' : 'degraded';
    if (!db.connected) reply.status(503);
    return {
      status,
      uptime: process.uptime(),
      version,
      db,
    };
  });

  // Startup probe — signals that initialization has completed
  app.get('/health/startup', async () => ({
    status: 'ok',
    started: true,
  }));

  // Legacy alias — keep for any existing clients
  app.get('/health', async () => ({ status: 'ok', ts: Date.now() }));
}
