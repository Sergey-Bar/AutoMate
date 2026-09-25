import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestApp, type TestApp } from '../../test/create-test-app.js';
import { randomUUID } from 'crypto';

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

describe('error-clustering routes', () => {
  const runId = randomUUID();

  beforeAll(async () => {
    testApp = await createTestApp();
    const { errorClusteringRoutes } = await import('../error-clustering.js');
    await errorClusteringRoutes(testApp.app);
    await testApp.app.ready();

    // Seed a run
    testApp.sqlite
      .prepare('INSERT INTO runs (id, started_at, status) VALUES (?, ?, ?)')
      .run(runId, '2023-11-14T22:13:20.000Z', 'finished');
  });

  beforeEach(() => {
    testApp.poolConnection.exec('DELETE FROM results');
  });

  afterAll(async () => {
    await testApp.app.close();
    testApp.poolConnection.close();
  });

  it('GET /api/error-clusters returns 400 without runId', async () => {
    const res = await testApp.app.inject({ method: 'GET', url: '/api/error-clusters' });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('runId');
  });

  it('GET /api/error-clusters returns empty array when no failures', async () => {
    const res = await testApp.app.inject({
      method: 'GET',
      url: `/api/error-clusters?runId=${runId}`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('GET /api/error-clusters returns clusters for failed results', async () => {
    // Insert two results with the same error
    const stmt = testApp.poolConnection.prepare(
      'INSERT INTO results (id, test_id, run_id, retry, status, error_message, error_stack) VALUES (?, ?, ?, ?, ?, ?, ?)',
    );
    stmt.run(randomUUID(), 'test-1', runId, 0, 'failed', 'Element not found', 'at test.ts:10');
    stmt.run(randomUUID(), 'test-2', runId, 0, 'failed', 'Element not found', 'at test.ts:20');

    const res = await testApp.app.inject({
      method: 'GET',
      url: `/api/error-clusters?runId=${runId}`,
    });

    expect(res.statusCode).toBe(200);
    const clusters = res.json();
    expect(clusters).toHaveLength(1);
    expect(clusters[0].count).toBe(2);
    expect(clusters[0].testIds).toContain('test-1');
    expect(clusters[0].testIds).toContain('test-2');
  });

  it('GET /api/error-clusters returns multiple clusters for different errors', async () => {
    const stmt = testApp.poolConnection.prepare(
      'INSERT INTO results (id, test_id, run_id, retry, status, error_message, error_stack) VALUES (?, ?, ?, ?, ?, ?, ?)',
    );
    stmt.run(randomUUID(), 'test-1', runId, 0, 'failed', 'Element not found in the DOM', null);
    stmt.run(randomUUID(), 'test-2', runId, 0, 'failed', 'Network request failed with status 500', null);

    const res = await testApp.app.inject({
      method: 'GET',
      url: `/api/error-clusters?runId=${runId}`,
    });

    expect(res.statusCode).toBe(200);
    const clusters = res.json();
    expect(clusters).toHaveLength(2);
  });
});
