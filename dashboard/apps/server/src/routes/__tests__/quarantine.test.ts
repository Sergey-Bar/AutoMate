import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestApp, type TestApp } from '../../test/create-test-app.js';
import * as fixtures from '../../test/fixtures.js';

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

describe('quarantine routes', () => {
  beforeAll(async () => {
    testApp = await createTestApp();
    const { quarantineRoutes } = await import('../quarantine.js');
    await quarantineRoutes(testApp.app);
    await testApp.app.ready();
  });

  beforeEach(() => {
    testApp.poolConnection.exec('DELETE FROM quarantine');
  });

  afterAll(async () => {
    await testApp.app.close();
    testApp.poolConnection.close();
  });

  it('GET /api/quarantine returns empty list initially', async () => {
    const res = await testApp.app.inject({ method: 'GET', url: '/api/quarantine' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('GET /api/quarantine returns only approved entries', async () => {
    // Insert one approved, one pending, one rejected
    testApp.poolConnection.exec(`
      INSERT INTO quarantine (id, test_title, test_file, quarantined_at, status) VALUES
        ('q-approved', 'approved test', 'a.spec.ts', '2024-01-01T00:00:00.000Z', 'approved'),
        ('q-pending',  'pending test',  'b.spec.ts', '2024-01-01T00:00:00.000Z', 'pending'),
        ('q-rejected', 'rejected test', 'c.spec.ts', '2024-01-01T00:00:00.000Z', 'rejected')
    `);

    const res = await testApp.app.inject({ method: 'GET', url: '/api/quarantine' });

    expect(res.statusCode).toBe(200);
    const rows = res.json() as Array<{ id: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('q-approved');
  });

  it('POST /api/quarantine creates entry and GET returns it', async () => {
    const createRes = await testApp.app.inject({
      method: 'POST',
      url: '/api/quarantine',
      payload: {
        testTitle: 'flaky login test',
        testFile: 'tests/login.spec.ts',
        reason: 'intermittent timeout',
      },
    });

    expect(createRes.statusCode).toBe(201);
    const createBody = createRes.json();
    expect(createBody.testTitle).toBe('flaky login test');
    expect(createBody.testFile).toBe('tests/login.spec.ts');
    expect(createBody.reason).toBe('intermittent timeout');
    expect(typeof createBody.id).toBe('string');

    const listRes = await testApp.app.inject({ method: 'GET', url: '/api/quarantine' });

    expect(listRes.statusCode).toBe(200);
    expect(listRes.json()).toEqual([
      {
        id: createBody.id,
        testTitle: 'flaky login test',
        testFile: 'tests/login.spec.ts',
        reason: 'intermittent timeout',
        quarantinedAt: expect.any(String),
        quarantinedBy: 'manual',
        status: 'approved',
        flakinessCategory: 'unknown',
        categoryConfidence: 0,
        categoryEvidence: [],
      },
    ]);
  });

  it('POST /api/quarantine allows optional reason to be omitted', async () => {
    const createRes = await testApp.app.inject({
      method: 'POST',
      url: '/api/quarantine',
      payload: {
        testTitle: 'without reason',
        testFile: 'tests/no-reason.spec.ts',
      },
    });

    expect(createRes.statusCode).toBe(201);
    const createBody = createRes.json();
    expect(createBody.reason).toBeUndefined();

    const rows = testApp.poolConnection.prepare('SELECT reason FROM quarantine WHERE id = ?').all(createBody.id);
    expect(rows).toEqual([{ reason: null }]);
  });

  it('POST /api/quarantine creates entry with status approved', async () => {
    const createRes = await testApp.app.inject({
      method: 'POST',
      url: '/api/quarantine',
      payload: { testTitle: 'manual entry', testFile: 'tests/manual.spec.ts' },
    });

    expect(createRes.statusCode).toBe(201);
    const id = createRes.json().id;

    const rows = testApp.sqlite
      .prepare('SELECT status FROM quarantine WHERE id = ?')
      .all(id) as Array<{ status: string }>;
    expect(rows[0].status).toBe('approved');
  });

  it('POST /api/quarantine rejects invalid body', async () => {
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/quarantine',
      payload: {
        testTitle: '',
        testFile: '',
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('Invalid body');
  });

  it('DELETE /api/quarantine/:id deletes entry with 204', async () => {
    const row = fixtures.quarantineEntry({
      testTitle: 'delete me',
      testFile: 'tests/delete-me.spec.ts',
      reason: 'temporary',
    });

    testApp.sqlite
      .prepare('INSERT INTO quarantine (id, test_title, test_file, reason, quarantined_at, quarantined_by, status) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(row.id, row.testTitle, row.testFile, row.reason, row.quarantinedAt, row.quarantinedBy, row.status);

    const delRes = await testApp.app.inject({ method: 'DELETE', url: `/api/quarantine/${row.id}` });

    expect(delRes.statusCode).toBe(204);
    expect(delRes.body).toBe('');

    const listRes = await testApp.app.inject({ method: 'GET', url: '/api/quarantine' });
    expect(listRes.json()).toEqual([]);
  });

  // ── Approval workflow ────────────────────────────────────────────────────

  it('GET /api/quarantine/pending returns pending entries', async () => {
    testApp.poolConnection.exec(`
      INSERT INTO quarantine (id, test_title, test_file, quarantined_at, status) VALUES
        ('p1', 'pending test', 'a.spec.ts', '2024-01-01T00:00:00.000Z', 'pending'),
        ('a1', 'approved test', 'b.spec.ts', '2024-01-01T00:00:00.000Z', 'approved')
    `);

    const res = await testApp.app.inject({ method: 'GET', url: '/api/quarantine/pending' });
    expect(res.statusCode).toBe(200);
    const rows = res.json() as Array<{ id: string; status: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('p1');
    expect(rows[0].status).toBe('pending');
  });

  it('PUT /api/quarantine/:id/approve sets status to approved', async () => {
    testApp.sqlite
      .prepare('INSERT INTO quarantine (id, test_title, test_file, quarantined_at, status) VALUES (?, ?, ?, ?, ?)')
      .run('pending-1', 'Flaky test', 'tests/flaky.spec.ts', new Date().toISOString(), 'pending');

    const res = await testApp.app.inject({ method: 'PUT', url: '/api/quarantine/pending-1/approve' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ id: 'pending-1', status: 'approved' });

    const rows = testApp.sqlite
      .prepare('SELECT status FROM quarantine WHERE id = ?')
      .all('pending-1') as Array<{ status: string }>;
    expect(rows[0].status).toBe('approved');
  });

  it('PUT /api/quarantine/:id/reject sets status to rejected', async () => {
    testApp.sqlite
      .prepare('INSERT INTO quarantine (id, test_title, test_file, quarantined_at, status) VALUES (?, ?, ?, ?, ?)')
      .run('pending-2', 'Flaky test', 'tests/flaky.spec.ts', new Date().toISOString(), 'pending');

    const res = await testApp.app.inject({ method: 'PUT', url: '/api/quarantine/pending-2/reject' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ id: 'pending-2', status: 'rejected' });

    const rows = testApp.sqlite
      .prepare('SELECT status FROM quarantine WHERE id = ?')
      .all('pending-2') as Array<{ status: string }>;
    expect(rows[0].status).toBe('rejected');
  });

  it('PUT /api/quarantine/:id/approve returns 404 for unknown id', async () => {
    const res = await testApp.app.inject({ method: 'PUT', url: '/api/quarantine/nonexistent/approve' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('Quarantine entry not found');
  });

  it('PUT /api/quarantine/:id/reject returns 404 for unknown id', async () => {
    const res = await testApp.app.inject({ method: 'PUT', url: '/api/quarantine/nonexistent/reject' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('Quarantine entry not found');
  });

  it('rejected entries do not appear in GET /api/quarantine', async () => {
    testApp.sqlite
      .prepare('INSERT INTO quarantine (id, test_title, test_file, quarantined_at, status) VALUES (?, ?, ?, ?, ?)')
      .run('rej-1', 'Rejected test', 'tests/rej.spec.ts', new Date().toISOString(), 'rejected');

    const res = await testApp.app.inject({ method: 'GET', url: '/api/quarantine' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(0);
  });
});
