/**
 * Tests for routes/admin/audit.ts — GET /api/admin/audit
 *
 * Uses createTestApp() (real in-memory SQLite) so Drizzle query
 * expressions work correctly. Feature flag and RBAC checks are
 * no-ops in NODE_ENV=test / rbac OFF (project convention).
 *
 * Covers:
 *  - 200 with empty array when no events exist
 *  - 200 with all events from the database
 *  - filters by actor, action, resourceType
 *  - filters by from/to date range
 *  - pagination via limit and offset params
 *  - large limit accepted without error
 *  - results are ordered newest-first by timestamp
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestApp, type TestApp } from '../../test/create-test-app.js';
import * as schema from '../../db/schema.js';

// ── DB mock — delegates to the test app's in-memory SQLite ────────────────────

let testApp: TestApp;

vi.mock('../../db/client.js', () => ({
  get db() { return testApp.db; },
  get sqlite() { return testApp.sqlite; },
  get poolConnection() {
    return {
      query: async (sql: string, params: any[] = []) => {
        const sqliteSql = sql.replace(/\$(\d+)/g, '?');
        const isSelect = sqliteSql.trim().toUpperCase().startsWith('SELECT');
        const stmt = testApp.sqlite.prepare(sqliteSql);
        if (isSelect) return { rows: stmt.all(params) };
        const info = stmt.run(params);
        return { rows: [], rowCount: info.changes };
      }
    };
  },
  isPostgres: false,
}));

// ── Helper ────────────────────────────────────────────────────────────────────

function insertAuditEvent(
  id: string,
  actorId: string,
  action: string,
  overrides: {
    timestamp?: string;
    resourceType?: string | null;
    resourceId?: string | null;
    actorType?: 'user' | 'system' | 'service';
  } = {},
) {
  const now = new Date().toISOString();
  testApp.db
    .insert(schema.auditEvents)
    .values({
      id,
      timestamp: overrides.timestamp ?? now,
      actorId,
      actorType: overrides.actorType ?? 'user',
      action,
      resourceType: overrides.resourceType ?? null,
      resourceId: overrides.resourceId ?? null,
      ip: '127.0.0.1',
      userAgent: 'test-agent',
      requestId: null,
      details: null,
      tenantId: null,
      createdAt: now,
    })
    .run();
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /api/admin/audit', () => {
  beforeAll(async () => {
    testApp = await createTestApp();
    const { auditRoutes } = await import('../admin/audit.js');
    await auditRoutes(testApp.app);
    await testApp.app.ready();
  });

  beforeEach(() => {
    testApp.poolConnection.exec('DELETE FROM audit_events');
  });

  afterAll(async () => {
    await testApp.app.close();
    testApp.poolConnection.close();
  });

  it('returns 200 with empty array when no events exist', async () => {
    const res = await testApp.app.inject({ method: 'GET', url: '/api/admin/audit' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('returns all audit events from the database', async () => {
    insertAuditEvent('evt-1', 'key-abc', 'auth.login');
    insertAuditEvent('evt-2', 'key-abc', 'key.create');

    const res = await testApp.app.inject({ method: 'GET', url: '/api/admin/audit' });

    expect(res.statusCode).toBe(200);
    const body = res.json() as unknown[];
    expect(body).toHaveLength(2);
  });

  it('filters events by actor query param', async () => {
    insertAuditEvent('evt-1', 'key-abc', 'auth.login');
    insertAuditEvent('evt-2', 'key-xyz', 'auth.login');

    const res = await testApp.app.inject({
      method: 'GET',
      url: '/api/admin/audit?actor=key-abc',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<{ actorId: string }>;
    expect(body).toHaveLength(1);
    expect(body[0].actorId).toBe('key-abc');
  });

  it('filters events by action query param', async () => {
    insertAuditEvent('evt-1', 'key-abc', 'auth.login');
    insertAuditEvent('evt-2', 'key-abc', 'key.create');

    const res = await testApp.app.inject({
      method: 'GET',
      url: '/api/admin/audit?action=key.create',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<{ action: string }>;
    expect(body).toHaveLength(1);
    expect(body[0].action).toBe('key.create');
  });

  it('filters events by resourceType query param', async () => {
    insertAuditEvent('evt-1', 'key-abc', 'key.create', { resourceType: 'api_key' });
    insertAuditEvent('evt-2', 'key-abc', 'auth.login', { resourceType: null });

    const res = await testApp.app.inject({
      method: 'GET',
      url: '/api/admin/audit?resourceType=api_key',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<{ resourceType: string }>;
    expect(body).toHaveLength(1);
    expect(body[0].resourceType).toBe('api_key');
  });

  it('filters events by from/to date range', async () => {
    insertAuditEvent('evt-old', 'key-abc', 'auth.login', {
      timestamp: '2020-01-01T00:00:00.000Z',
    });
    insertAuditEvent('evt-new', 'key-abc', 'auth.login', {
      timestamp: '2025-06-01T12:00:00.000Z',
    });

    const res = await testApp.app.inject({
      method: 'GET',
      url: '/api/admin/audit?from=2025-01-01T00:00:00.000Z&to=2025-12-31T23:59:59.999Z',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<{ id: string }>;
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe('evt-new');
  });

  it('applies limit parameter — returns at most N events', async () => {
    for (let i = 1; i <= 3; i++) {
      insertAuditEvent(`evt-${i}`, 'key-abc', 'auth.login');
    }

    const res = await testApp.app.inject({
      method: 'GET',
      url: '/api/admin/audit?limit=1',
    });

    expect(res.statusCode).toBe(200);
    expect((res.json() as unknown[]).length).toBe(1);
  });

  it('applies offset parameter — skips first N events', async () => {
    for (let i = 1; i <= 3; i++) {
      insertAuditEvent(`evt-${i}`, 'key-abc', 'auth.login');
    }

    const res = await testApp.app.inject({
      method: 'GET',
      url: '/api/admin/audit?offset=2',
    });

    expect(res.statusCode).toBe(200);
    expect((res.json() as unknown[]).length).toBe(1);
  });

  it('accepts large limit param without error', async () => {
    insertAuditEvent('evt-1', 'key-abc', 'auth.login');

    const res = await testApp.app.inject({
      method: 'GET',
      url: '/api/admin/audit?limit=9999',
    });

    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });

  it('returns events ordered newest-first by timestamp', async () => {
    insertAuditEvent('evt-old', 'key-abc', 'auth.login', {
      timestamp: '2024-01-01T00:00:00.000Z',
    });
    insertAuditEvent('evt-new', 'key-abc', 'key.create', {
      timestamp: '2025-01-01T00:00:00.000Z',
    });

    const res = await testApp.app.inject({ method: 'GET', url: '/api/admin/audit' });

    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<{ id: string }>;
    expect(body[0].id).toBe('evt-new');
    expect(body[1].id).toBe('evt-old');
  });
});
