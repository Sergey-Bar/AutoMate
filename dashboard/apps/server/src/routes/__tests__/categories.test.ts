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

describe('categories routes', () => {
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

  it('GET /api/categories returns empty list initially', async () => {
    const res = await testApp.app.inject({ method: 'GET', url: '/api/categories' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('POST /api/categories creates category and applies default color', async () => {
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/categories',
      payload: { name: 'infra' },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.name).toBe('infra');
    expect(body.color).toBe('#6b7280');
    expect(typeof body.id).toBe('string');
    expect(typeof body.createdAt).toBe('string');
  });

  it('POST /api/categories rejects invalid body', async () => {
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/categories',
      payload: { name: '' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.fieldErrors.name).toEqual(['String must contain at least 1 character(s)']);
  });

  it('PUT /api/categories/:id updates category fields', async () => {
    const seeded = fixtures.workspace();
    testApp.sqlite
      .prepare('INSERT INTO defect_categories (id, name, color, created_at) VALUES (?, ?, ?, ?)')
      .run(seeded.id, 'qa', '#000000', seeded.createdAt);

    const updateRes = await testApp.app.inject({
      method: 'PUT',
      url: `/api/categories/${seeded.id}`,
      payload: { name: 'platform', color: '#ffffff' },
    });

    expect(updateRes.statusCode).toBe(200);
    expect(updateRes.json()).toEqual({ ok: true });

    const listRes = await testApp.app.inject({ method: 'GET', url: '/api/categories' });
    expect(listRes.json()).toEqual([
      {
        id: seeded.id,
        name: 'platform',
        color: '#ffffff',
        createdAt: seeded.createdAt,
      },
    ]);
  });

  it('DELETE /api/categories/:id deletes category', async () => {
    const seeded = fixtures.workspace();
    testApp.sqlite
      .prepare('INSERT INTO defect_categories (id, name, color, created_at) VALUES (?, ?, ?, ?)')
      .run(seeded.id, 'legacy', '#111111', seeded.createdAt);

    const delRes = await testApp.app.inject({
      method: 'DELETE',
      url: `/api/categories/${seeded.id}`,
    });

    expect(delRes.statusCode).toBe(200);
    expect(delRes.json()).toEqual({ ok: true });

    const listRes = await testApp.app.inject({ method: 'GET', url: '/api/categories' });
    expect(listRes.json()).toEqual([]);
  });

  it('GET /api/fingerprint-categories returns empty list initially', async () => {
    const res = await testApp.app.inject({ method: 'GET', url: '/api/fingerprint-categories' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('PUT /api/fingerprint-categories/:fingerprint assigns and upserts category', async () => {
    const catA = fixtures.workspace();
    const catB = fixtures.workspace();
    testApp.sqlite
      .prepare('INSERT INTO defect_categories (id, name, color, created_at) VALUES (?, ?, ?, ?)')
      .run(catA.id, 'network', '#aaaaaa', catA.createdAt);
    testApp.sqlite
      .prepare('INSERT INTO defect_categories (id, name, color, created_at) VALUES (?, ?, ?, ?)')
      .run(catB.id, 'ui', '#bbbbbb', catB.createdAt);

    const assignRes = await testApp.app.inject({
      method: 'PUT',
      url: '/api/fingerprint-categories/fp-123',
      payload: { categoryId: catA.id },
    });

    expect(assignRes.statusCode).toBe(200);
    expect(assignRes.json()).toEqual({ ok: true });

    const reassignRes = await testApp.app.inject({
      method: 'PUT',
      url: '/api/fingerprint-categories/fp-123',
      payload: { categoryId: catB.id },
    });

    expect(reassignRes.statusCode).toBe(200);
    expect(reassignRes.json()).toEqual({ ok: true });

    const listRes = await testApp.app.inject({ method: 'GET', url: '/api/fingerprint-categories' });
    expect(listRes.statusCode).toBe(200);
    expect(listRes.json().length).toBe(1);
    expect(listRes.json()[0].fingerprint).toBe('fp-123');
    expect(listRes.json()[0].categoryId).toBe(catB.id);
    expect(typeof listRes.json()[0].assignedAt).toBe('string');
  });

  it('DELETE /api/fingerprint-categories/:fingerprint removes assignment', async () => {
    const cat = fixtures.workspace();
    testApp.sqlite
      .prepare('INSERT INTO defect_categories (id, name, color, created_at) VALUES (?, ?, ?, ?)')
      .run(cat.id, 'backend', '#cccccc', cat.createdAt);
    testApp.sqlite
      .prepare('INSERT INTO fingerprint_categories (fingerprint, category_id, assigned_at) VALUES (?, ?, ?)')
      .run('fp-delete', cat.id, '2023-11-14T22:13:20.000Z');

    const delRes = await testApp.app.inject({
      method: 'DELETE',
      url: '/api/fingerprint-categories/fp-delete',
    });

    expect(delRes.statusCode).toBe(200);
    expect(delRes.json()).toEqual({ ok: true });

    const listRes = await testApp.app.inject({ method: 'GET', url: '/api/fingerprint-categories' });
    expect(listRes.json()).toEqual([]);
  });
});
