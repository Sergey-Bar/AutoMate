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

// Covers the ?? fallback branches in fixtures.ts (lines 219-220)
describe('fixtures.knownFailure defaults', () => {
  it('returns default testTitle and testFile when no overrides are provided', () => {
    const kf = fixtures.knownFailure();
    expect(kf.testTitle).toBe('Known Broken Test');
    expect(kf.testFile).toBe('tests/broken.spec.ts');
  });
});

describe('known-failures routes', () => {
  beforeAll(async () => {
    testApp = await createTestApp();
    const { knownFailureRoutes } = await import('../known-failures.js');
    await knownFailureRoutes(testApp.app);
    await testApp.app.ready();
  });

  beforeEach(() => {
    testApp.poolConnection.exec('DELETE FROM known_failures');
  });

  afterAll(async () => {
    await testApp.app.close();
    testApp.poolConnection.close();
  });

  it('GET /api/known-failures returns empty list initially', async () => {
    const res = await testApp.app.inject({ method: 'GET', url: '/api/known-failures' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('POST /api/known-failures creates entry and GET returns it', async () => {
    const createRes = await testApp.app.inject({
      method: 'POST',
      url: '/api/known-failures',
      payload: {
        testTitle: 'known broken checkout',
        testFile: 'tests/checkout.spec.ts',
        comment: 'tracked by BUG-42',
      },
    });

    expect(createRes.statusCode).toBe(201);
    const createBody = createRes.json();
    expect(createBody.testTitle).toBe('known broken checkout');
    expect(createBody.testFile).toBe('tests/checkout.spec.ts');
    expect(createBody.comment).toBe('tracked by BUG-42');
    expect(typeof createBody.id).toBe('string');

    const listRes = await testApp.app.inject({ method: 'GET', url: '/api/known-failures' });

    expect(listRes.statusCode).toBe(200);
    expect(listRes.json()).toEqual([
      {
        id: createBody.id,
        testTitle: 'known broken checkout',
        testFile: 'tests/checkout.spec.ts',
        comment: 'tracked by BUG-42',
        createdAt: expect.any(String),
        createdBy: 'manual',
      },
    ]);
  });

  it('POST /api/known-failures rejects invalid body', async () => {
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/known-failures',
      payload: {
        testTitle: '',
        testFile: '',
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('Invalid body');
  });

  it('DELETE /api/known-failures/:id deletes entry with 204', async () => {
    const row = fixtures.knownFailure({
      testTitle: 'delete known failure',
      testFile: 'tests/delete-known.spec.ts',
      comment: 'cleanup',
    });

    testApp.sqlite
      .prepare('INSERT INTO known_failures (id, test_title, test_file, comment, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?)')
      .run(row.id, row.testTitle, row.testFile, row.comment, row.createdAt, row.createdBy);

    const delRes = await testApp.app.inject({ method: 'DELETE', url: `/api/known-failures/${row.id}` });

    expect(delRes.statusCode).toBe(204);
    expect(delRes.body).toBe('');

    const listRes = await testApp.app.inject({ method: 'GET', url: '/api/known-failures' });
    expect(listRes.json()).toEqual([]);
  });
});
