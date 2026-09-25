/**
 * Branch coverage for categories routes.
 * Targets:
 *  - PUT /api/categories/:id with invalid body → covers `if (!body) return;` (line 32)
 *  - PUT /api/categories/:id without color → covers `color ?? '#6b7280'` default branch (line 34)
 *  - DELETE /api/categories/:id with non-existent ID → covers 404 (line 45)
 *  - PUT /api/fingerprint-categories/:fingerprint with invalid body → covers `if (!body) return;` (line 58)
 *  - DELETE /api/fingerprint-categories/:fingerprint with non-existent ID → covers 404 (lines 72-73)
 */
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

describe('categories routes — branch coverage', () => {
  beforeAll(async () => {
    testApp = await createTestApp();
    const { categoriesRoutes } = await import('../categories.js');
    await categoriesRoutes(testApp.app);
    await testApp.app.ready();
  });

  beforeEach(() => {
    testApp.poolConnection.exec('DELETE FROM fingerprint_categories');
    testApp.poolConnection.exec('DELETE FROM defect_categories');
  });

  afterAll(async () => {
    await testApp.app.close();
    testApp.poolConnection.close();
  });

  it('PUT /api/categories/:id with invalid body returns 400 (covers validation failure branch)', async () => {
    const seeded = fixtures.workspace();
    testApp.sqlite
      .prepare('INSERT INTO defect_categories (id, name, color, created_at) VALUES (?, ?, ?, ?)')
      .run(seeded.id, 'qa', '#000000', seeded.createdAt);

    const res = await testApp.app.inject({
      method: 'PUT',
      url: `/api/categories/${seeded.id}`,
      payload: { name: '' }, // Empty name → fails min(1) validation
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBeDefined();
  });

  it('PUT /api/categories/:id without color uses default #6b7280 (covers ?? default branch)', async () => {
    const seeded = fixtures.workspace();
    testApp.sqlite
      .prepare('INSERT INTO defect_categories (id, name, color, created_at) VALUES (?, ?, ?, ?)')
      .run(seeded.id, 'qa', '#000000', seeded.createdAt);

    const res = await testApp.app.inject({
      method: 'PUT',
      url: `/api/categories/${seeded.id}`,
      payload: { name: 'updated-no-color' }, // No color → uses default
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });

    // Verify the default color was applied
    const listRes = await testApp.app.inject({ method: 'GET', url: '/api/categories' });
    const cats = listRes.json() as Array<{ color: string; name: string }>;
    const updated = cats.find((c) => c.name === 'updated-no-color');
    expect(updated?.color).toBe('#6b7280');
  });

  it('DELETE /api/categories/:id with non-existent ID returns 404 (covers deleted.length===0 branch)', async () => {
    const res = await testApp.app.inject({
      method: 'DELETE',
      url: '/api/categories/non-existent-id',
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'Category not found' });
  });

  it('PUT /api/fingerprint-categories/:fingerprint with invalid body returns 400 (covers validation failure branch)', async () => {
    const res = await testApp.app.inject({
      method: 'PUT',
      url: '/api/fingerprint-categories/fp-test',
      payload: {}, // Missing required categoryId
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBeDefined();
  });

  it('DELETE /api/fingerprint-categories/:fingerprint with non-existent fingerprint returns 404 (covers deleted.length===0 branch)', async () => {
    const res = await testApp.app.inject({
      method: 'DELETE',
      url: '/api/fingerprint-categories/fp-nonexistent',
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'Fingerprint category assignment not found' });
  });
});
