import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestApp, type TestApp } from '../../test/create-test-app.js';

let testApp: TestApp;

const reloadMock = vi.fn().mockResolvedValue(undefined);

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

vi.mock('../../services/scheduler.js', () => ({
  scheduler: { reload: reloadMock },
}));

describe('schedules routes', () => {
  beforeAll(async () => {
    testApp = await createTestApp();
    const { schedulesRoutes } = await import('../schedules.js');
    await schedulesRoutes(testApp.app);
    await testApp.app.ready();
  });

  beforeEach(() => {
    testApp.poolConnection.exec('DELETE FROM schedules');
    reloadMock.mockClear();
  });

  afterAll(async () => {
    await testApp.app.close();
    testApp.poolConnection.close();
  });

  it('GET /api/schedules returns empty array when no schedules exist', async () => {
    const res = await testApp.app.inject({ method: 'GET', url: '/api/schedules' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('POST /api/schedules creates schedule and calls scheduler.reload', async () => {
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/schedules',
      payload: {
        cronExpr: '*/5 * * * *',
        enabled: false,
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(typeof body.id).toBe('string');
    expect(body).toMatchObject({
      cronExpr: '*/5 * * * *',
      enabled: false,
    });
    expect(reloadMock).toHaveBeenCalledTimes(1);
  });

  it('POST /api/schedules defaults enabled to true when omitted', async () => {
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/schedules',
      payload: {
        cronExpr: '0 0 * * *',
      },
    });

    expect(res.statusCode).toBe(201);

    const row = testApp.sqlite
      .prepare('SELECT enabled FROM schedules WHERE id = ?')
      .get(res.json().id) as { enabled: number };
    expect(row.enabled).toBe(1);
    expect(reloadMock).toHaveBeenCalledTimes(1);
  });

  it('POST /api/schedules returns 400 on invalid body', async () => {
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/schedules',
      payload: {
        enabled: true,
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('Invalid schedule');
    expect(reloadMock).not.toHaveBeenCalled();
  });

  it('POST /api/schedules stores runOptions as JSON string', async () => {
    const payload = {
      cronExpr: '15 * * * *',
      runOptions: {
        grep: '@smoke',
        workers: 4,
      },
    };

    const res = await testApp.app.inject({ method: 'POST', url: '/api/schedules', payload });

    expect(res.statusCode).toBe(201);
    const row = testApp.sqlite
      .prepare('SELECT run_options FROM schedules WHERE id = ?')
      .get(res.json().id) as { run_options: string | null };
    expect(row.run_options).toBe(JSON.stringify(payload.runOptions));
  });

  it('PUT /api/schedules/:id updates fields and calls scheduler.reload', async () => {
    const createRes = await testApp.app.inject({
      method: 'POST',
      url: '/api/schedules',
      payload: {
        cronExpr: '0 */6 * * *',
      },
    });
    const { id } = createRes.json();
    reloadMock.mockClear();

    const updateRes = await testApp.app.inject({
      method: 'PUT',
      url: `/api/schedules/${id}`,
      payload: {
        cronExpr: '0 */12 * * *',
        enabled: false,
        runOptions: { project: 'chromium' },
      },
    });

    expect(updateRes.statusCode).toBe(200);
    expect(updateRes.json()).toEqual({ ok: true });
    expect(reloadMock).toHaveBeenCalledTimes(1);

    const row = testApp.sqlite
      .prepare('SELECT cron_expr, enabled, run_options FROM schedules WHERE id = ?')
      .get(id) as { cron_expr: string; enabled: number; run_options: string | null };
    expect(row).toEqual({
      cron_expr: '0 */12 * * *',
      enabled: 0,
      run_options: JSON.stringify({ project: 'chromium' }),
    });
  });

  it('PUT /api/schedules/:id returns 400 on invalid body', async () => {
    const createRes = await testApp.app.inject({
      method: 'POST',
      url: '/api/schedules',
      payload: {
        cronExpr: '0 */6 * * *',
      },
    });
    const { id } = createRes.json();
    reloadMock.mockClear();

    const res = await testApp.app.inject({
      method: 'PUT',
      url: `/api/schedules/${id}`,
      payload: {
        enabled: 'yes',
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('Invalid schedule');
    expect(reloadMock).not.toHaveBeenCalled();
  });

  it('PUT /api/schedules/:id updates only cronExpr when runOptions and enabled are omitted', async () => {
    const createRes = await testApp.app.inject({
      method: 'POST',
      url: '/api/schedules',
      payload: { cronExpr: '0 0 * * *', enabled: true, runOptions: { project: 'chromium' } },
    });
    const { id } = createRes.json();
    reloadMock.mockClear();

    const updateRes = await testApp.app.inject({
      method: 'PUT',
      url: `/api/schedules/${id}`,
      payload: { cronExpr: '0 12 * * *' },
    });

    expect(updateRes.statusCode).toBe(200);
    expect(updateRes.json()).toEqual({ ok: true });

    const row = testApp.sqlite
      .prepare('SELECT cron_expr, enabled FROM schedules WHERE id = ?')
      .get(id) as { cron_expr: string; enabled: number };
    expect(row.cron_expr).toBe('0 12 * * *');
    expect(row.enabled).toBe(1); // unchanged
  });

  it('PUT /api/schedules/:id updates only enabled when cronExpr and runOptions are omitted', async () => {
    const createRes = await testApp.app.inject({
      method: 'POST',
      url: '/api/schedules',
      payload: { cronExpr: '0 0 * * *', enabled: true },
    });
    const { id } = createRes.json();
    reloadMock.mockClear();

    const updateRes = await testApp.app.inject({
      method: 'PUT',
      url: `/api/schedules/${id}`,
      payload: { enabled: false },
    });

    expect(updateRes.statusCode).toBe(200);
    expect(updateRes.json()).toEqual({ ok: true });

    const row = testApp.sqlite
      .prepare('SELECT cron_expr, enabled FROM schedules WHERE id = ?')
      .get(id) as { cron_expr: string; enabled: number };
    expect(row.cron_expr).toBe('0 0 * * *'); // unchanged
    expect(row.enabled).toBe(0);
  });

  it('DELETE /api/schedules/:id removes schedule, returns 204, and calls scheduler.reload', async () => {
    const createRes = await testApp.app.inject({
      method: 'POST',
      url: '/api/schedules',
      payload: {
        cronExpr: '0 1 * * *',
      },
    });
    const { id } = createRes.json();
    reloadMock.mockClear();

    const delRes = await testApp.app.inject({ method: 'DELETE', url: `/api/schedules/${id}` });

    expect(delRes.statusCode).toBe(204);
    expect(delRes.body).toBe('');
    expect(reloadMock).toHaveBeenCalledTimes(1);

    const row = testApp.sqlite
      .prepare('SELECT COUNT(*) as cnt FROM schedules WHERE id = ?')
      .get(id) as { cnt: number };
    expect(row.cnt).toBe(0);
  });
});
