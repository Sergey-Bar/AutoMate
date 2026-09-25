import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestApp, type TestApp } from '../../test/create-test-app.js';

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

describe('gate routes', () => {
  beforeAll(async () => {
    testApp = await createTestApp();
    const { gateRoutes } = await import('../gate.js');
    await gateRoutes(testApp.app);
    await testApp.app.ready();
  });

  beforeEach(() => {
    testApp.poolConnection.exec('DELETE FROM quality_gate_config');
  });

  afterAll(async () => {
    await testApp.app.close();
    testApp.poolConnection.close();
  });

  it('GET /api/gate-config returns defaults when no config exists', async () => {
    const res = await testApp.app.inject({ method: 'GET', url: '/api/gate-config' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      id: 'global',
      passRateThreshold: 100,
      maxDurationMs: null,
      maxFlakyCount: null,
    });
  });

  it('PUT /api/gate-config creates config and GET returns saved config', async () => {
    const putRes = await testApp.app.inject({
      method: 'PUT',
      url: '/api/gate-config',
      payload: {
        passRateThreshold: 92.5,
        maxDurationMs: 120000,
        maxFlakyCount: 3,
      },
    });

    expect(putRes.statusCode).toBe(200);
    expect(putRes.json()).toEqual({ ok: true });

    const getRes = await testApp.app.inject({ method: 'GET', url: '/api/gate-config' });
    expect(getRes.statusCode).toBe(200);
    expect(getRes.json()).toMatchObject({
      id: 'global',
      passRateThreshold: 92.5,
      maxDurationMs: 120000,
      maxFlakyCount: 3,
    });
  });

  it('PUT /api/gate-config updates existing config via upsert', async () => {
    await testApp.app.inject({
      method: 'PUT',
      url: '/api/gate-config',
      payload: {
        passRateThreshold: 95,
        maxDurationMs: 300000,
        maxFlakyCount: 2,
      },
    });

    const secondPut = await testApp.app.inject({
      method: 'PUT',
      url: '/api/gate-config',
      payload: {
        passRateThreshold: 80,
        maxDurationMs: null,
      },
    });

    expect(secondPut.statusCode).toBe(200);

    const rowCount = testApp.poolConnection.prepare('SELECT COUNT(*) AS cnt FROM quality_gate_config').get() as { cnt: number };
    expect(rowCount.cnt).toBe(1);

    const getRes = await testApp.app.inject({ method: 'GET', url: '/api/gate-config' });
    expect(getRes.json()).toMatchObject({
      id: 'global',
      passRateThreshold: 80,
      maxDurationMs: null,
      maxFlakyCount: null,
    });
  });

  it('PUT /api/gate-config returns 400 for invalid passRateThreshold values', async () => {
    const negativeRes = await testApp.app.inject({
      method: 'PUT',
      url: '/api/gate-config',
      payload: {
        passRateThreshold: -1,
      },
    });
    expect(negativeRes.statusCode).toBe(400);

    const overRes = await testApp.app.inject({
      method: 'PUT',
      url: '/api/gate-config',
      payload: {
        passRateThreshold: 101,
      },
    });
    expect(overRes.statusCode).toBe(400);

    const missingRes = await testApp.app.inject({
      method: 'PUT',
      url: '/api/gate-config',
      payload: {
        maxDurationMs: 5000,
      },
    });
    expect(missingRes.statusCode).toBe(400);
  });

  it('PUT /api/gate-config handles optional fields by persisting null when omitted', async () => {
    const putRes = await testApp.app.inject({
      method: 'PUT',
      url: '/api/gate-config',
      payload: {
        passRateThreshold: 88,
      },
    });

    expect(putRes.statusCode).toBe(200);

    const getRes = await testApp.app.inject({ method: 'GET', url: '/api/gate-config' });
    expect(getRes.statusCode).toBe(200);
    expect(getRes.json()).toMatchObject({
      id: 'global',
      passRateThreshold: 88,
      maxDurationMs: null,
      maxFlakyCount: null,
    });
  });
});
