/**
 * Tests for routes/health.ts — healthRoutes
 *
 * Covers:
 *  - GET /health/live     → 200 { status: 'ok' }
 *  - GET /health/ready    → 200 { status, uptime, version, db: { connected, tables } }
 *  - GET /health/ready    → 503 when DB fails
 *  - GET /health/startup  → 200 { status: 'ok', started: true }
 *  - GET /health          → 200 { status: 'ok', ts: <number> } (legacy alias)
 *  - Health endpoints are accessible without auth header
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import { healthRoutes, type DbConnection } from '../health.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeSqlite(tableCount = 5): DbConnection {
  return {
    prepare: vi.fn().mockReturnValue({
      get: vi.fn().mockReturnValue({ cnt: tableCount }),
    }),
  } as DbConnection;
}

function makeFailingSqlite(): DbConnection {
  return {
    prepare: vi.fn().mockImplementation(() => {
      throw new Error('DB connection failed');
    }),
  } as DbConnection;
}

async function buildHealthApp(
  conn: DbConnection,
  version = '2.0.0',
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await healthRoutes(app, { sqlite: conn, version });

  await app.ready();
  return app;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('healthRoutes', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app?.close();
  });

  // ── /health/live ───────────────────────────────────────────────────────────

  describe('GET /health/live', () => {
    beforeEach(async () => {
      app = await buildHealthApp(makeSqlite());
    });

    it('returns 200', async () => {
      const res = await app.inject({ method: 'GET', url: '/health/live' });
      expect(res.statusCode).toBe(200);
    });

    it('returns { status: "ok" }', async () => {
      const res = await app.inject({ method: 'GET', url: '/health/live' });
      expect(res.json()).toEqual({ status: 'ok' });
    });

    it('does NOT include uptime or version (simple liveness)', async () => {
      const res = await app.inject({ method: 'GET', url: '/health/live' });
      const body = res.json() as Record<string, unknown>;
      expect(body.uptime).toBeUndefined();
      expect(body.version).toBeUndefined();
    });
  });

  // ── /health/ready ──────────────────────────────────────────────────────────

  describe('GET /health/ready — DB connected', () => {
    beforeEach(async () => {
      app = await buildHealthApp(makeSqlite(12), '2.0.0');
    });

    it('returns 200 when DB is connected', async () => {
      const res = await app.inject({ method: 'GET', url: '/health/ready' });
      expect(res.statusCode).toBe(200);
    });

    it('returns status "ok"', async () => {
      const res = await app.inject({ method: 'GET', url: '/health/ready' });
      const body = res.json() as Record<string, unknown>;
      expect(body.status).toBe('ok');
    });

    it('includes uptime as a number', async () => {
      const res = await app.inject({ method: 'GET', url: '/health/ready' });
      const body = res.json() as Record<string, unknown>;
      expect(typeof body.uptime).toBe('number');
      expect(body.uptime).toBeGreaterThanOrEqual(0);
    });

    it('includes version from opts', async () => {
      const res = await app.inject({ method: 'GET', url: '/health/ready' });
      const body = res.json() as Record<string, unknown>;
      expect(body.version).toBe('2.0.0');
    });

    it('includes db.connected = true', async () => {
      const res = await app.inject({ method: 'GET', url: '/health/ready' });
      const body = res.json() as { db: Record<string, unknown> };
      expect(body.db.connected).toBe(true);
    });

    it('includes db.tables count', async () => {
      const res = await app.inject({ method: 'GET', url: '/health/ready' });
      const body = res.json() as { db: Record<string, unknown> };
      expect(body.db.tables).toBe(12);
    });

    it('queries sqlite_master for table count', async () => {
      const sqlite = makeSqlite(7);
      app = await buildHealthApp(sqlite, '2.0.0');
      await app.inject({ method: 'GET', url: '/health/ready' });
      expect(sqlite.prepare).toHaveBeenCalledWith(
        expect.stringContaining("sqlite_master"),
      );
    });
  });

  describe('GET /health/ready — DB failing', () => {
    beforeEach(async () => {
      app = await buildHealthApp(makeFailingSqlite(), '2.0.0');
    });

    it('returns 503 when DB is unavailable', async () => {
      const res = await app.inject({ method: 'GET', url: '/health/ready' });
      expect(res.statusCode).toBe(503);
    });

    it('returns status "degraded"', async () => {
      const res = await app.inject({ method: 'GET', url: '/health/ready' });
      const body = res.json() as Record<string, unknown>;
      expect(body.status).toBe('degraded');
    });

    it('returns db.connected = false', async () => {
      const res = await app.inject({ method: 'GET', url: '/health/ready' });
      const body = res.json() as { db: Record<string, unknown> };
      expect(body.db.connected).toBe(false);
    });

    it('includes db.error message', async () => {
      const res = await app.inject({ method: 'GET', url: '/health/ready' });
      const body = res.json() as { db: Record<string, unknown> };
      expect(typeof body.db.error).toBe('string');
    });
  });

  // ── /health/startup ────────────────────────────────────────────────────────

  describe('GET /health/startup', () => {
    beforeEach(async () => {
      app = await buildHealthApp(makeSqlite());
    });

    it('returns 200', async () => {
      const res = await app.inject({ method: 'GET', url: '/health/startup' });
      expect(res.statusCode).toBe(200);
    });

    it('returns { status: "ok", started: true }', async () => {
      const res = await app.inject({ method: 'GET', url: '/health/startup' });
      expect(res.json()).toEqual({ status: 'ok', started: true });
    });
  });

  // ── /health (legacy alias) ─────────────────────────────────────────────────

  describe('GET /health (legacy alias)', () => {
    beforeEach(async () => {
      app = await buildHealthApp(makeSqlite());
    });

    it('returns 200', async () => {
      const res = await app.inject({ method: 'GET', url: '/health' });
      expect(res.statusCode).toBe(200);
    });

    it('returns { status: "ok" } with a ts timestamp', async () => {
      const res = await app.inject({ method: 'GET', url: '/health' });
      const body = res.json() as Record<string, unknown>;
      expect(body.status).toBe('ok');
      expect(typeof body.ts).toBe('number');
    });
  });

  // ── No auth required ───────────────────────────────────────────────────────

  describe('health endpoints are accessible without auth headers', () => {
    beforeEach(async () => {
      app = await buildHealthApp(makeSqlite());
    });

    it('/health/live works without Authorization header', async () => {
      const res = await app.inject({ method: 'GET', url: '/health/live' });
      expect(res.statusCode).toBe(200);
    });

    it('/health/ready works without Authorization header', async () => {
      const res = await app.inject({ method: 'GET', url: '/health/ready' });
      expect(res.statusCode).toBe(200);
    });

    it('/health/startup works without Authorization header', async () => {
      const res = await app.inject({ method: 'GET', url: '/health/startup' });
      expect(res.statusCode).toBe(200);
    });

    it('/health works without Authorization header', async () => {
      const res = await app.inject({ method: 'GET', url: '/health' });
      expect(res.statusCode).toBe(200);
    });
  });
});
