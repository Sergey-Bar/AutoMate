import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestApp, type TestApp } from '../../../test/create-test-app.js';
import * as fixtures from '../../../test/fixtures.js';
import * as schema from '../../../db/schema.js';

let testApp: TestApp;

const reloadMock = vi.fn().mockResolvedValue(undefined);

vi.mock('../../../db/client.js', () => ({
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

vi.mock('../../../services/scheduler.js', () => ({ scheduler: { reload: reloadMock } }));

describe('CRUD entities integration routes', () => {
  beforeAll(async () => {
    testApp = await createTestApp();

    const { quarantineRoutes } = await import('../../quarantine.js');
    const { knownFailureRoutes } = await import('../../known-failures.js');
    const { schedulesRoutes } = await import('../../schedules.js');
    const { workspacesRoutes } = await import('../../workspaces.js');
    const { categoriesRoutes } = await import('../../categories.js');
    const { gateRoutes } = await import('../../gate.js');

    await quarantineRoutes(testApp.app);
    await knownFailureRoutes(testApp.app);
    await schedulesRoutes(testApp.app);
    await workspacesRoutes(testApp.app);
    await categoriesRoutes(testApp.app);
    await gateRoutes(testApp.app);

    await testApp.app.ready();
  });

  beforeEach(() => {
    testApp.poolConnection.exec('DELETE FROM fingerprint_categories');
    testApp.poolConnection.exec('DELETE FROM defect_categories');
    testApp.poolConnection.exec('DELETE FROM quality_gate_config');
    testApp.poolConnection.exec('DELETE FROM workspaces');
    testApp.poolConnection.exec('DELETE FROM schedules');
    testApp.poolConnection.exec('DELETE FROM known_failures');
    testApp.poolConnection.exec('DELETE FROM quarantine');
    reloadMock.mockClear();

    const checkFixture = fixtures.quarantineEntry();
    expect(checkFixture.id).toBeTruthy();
    expect(schema.qualityGateConfig.id.name).toBe('id');
  });

  afterAll(async () => {
    await testApp.app.close();
    testApp.poolConnection.close();
  });

  describe('quarantine routes', () => {
    it('GET /api/quarantine returns empty list initially', async () => {
      const res = await testApp.app.inject({ method: 'GET', url: '/api/quarantine' });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
    });

    it('POST /api/quarantine creates entry', async () => {
      const res = await testApp.app.inject({
        method: 'POST',
        url: '/api/quarantine',
        payload: {
          testTitle: 'flaky spec',
          testFile: 'tests/flaky.spec.ts',
          reason: 'network timeout',
        },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({
        testTitle: 'flaky spec',
        testFile: 'tests/flaky.spec.ts',
        reason: 'network timeout',
      });
    });

    it('POST /api/quarantine rejects invalid payload', async () => {
      const res = await testApp.app.inject({
        method: 'POST',
        url: '/api/quarantine',
        payload: { testTitle: '', testFile: '' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('Invalid body');
    });

    it('GET after POST includes created quarantine entry', async () => {
      await testApp.app.inject({
        method: 'POST',
        url: '/api/quarantine',
        payload: {
          testTitle: 'intermittent login',
          testFile: 'tests/login.spec.ts',
        },
      });

      const res = await testApp.app.inject({ method: 'GET', url: '/api/quarantine' });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toHaveLength(1);
      expect(res.json()[0]).toMatchObject({
        testTitle: 'intermittent login',
        testFile: 'tests/login.spec.ts',
      });
    });

    it('DELETE /api/quarantine/:id removes existing entry', async () => {
      const created = await testApp.app.inject({
        method: 'POST',
        url: '/api/quarantine',
        payload: {
          testTitle: 'remove me',
          testFile: 'tests/remove.spec.ts',
        },
      });
      const id = created.json().id as string;

      const delRes = await testApp.app.inject({ method: 'DELETE', url: `/api/quarantine/${id}` });

      expect(delRes.statusCode).toBe(204);

      const listRes = await testApp.app.inject({ method: 'GET', url: '/api/quarantine' });
      expect(listRes.json()).toEqual([]);
    });

    it('DELETE /api/quarantine/:id returns 404 when entry does not exist', async () => {
      const res = await testApp.app.inject({ method: 'DELETE', url: '/api/quarantine/missing' });

      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: 'Quarantine entry not found' });
    });
  });

  describe('known-failures routes', () => {
    it('GET /api/known-failures returns empty list initially', async () => {
      const res = await testApp.app.inject({ method: 'GET', url: '/api/known-failures' });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
    });

    it('POST /api/known-failures creates entry', async () => {
      const res = await testApp.app.inject({
        method: 'POST',
        url: '/api/known-failures',
        payload: {
          testTitle: 'known broken test',
          testFile: 'tests/known.spec.ts',
          comment: 'tracking as known-failure',
        },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({
        testTitle: 'known broken test',
        testFile: 'tests/known.spec.ts',
        comment: 'tracking as known-failure',
      });
    });

    it('POST /api/known-failures rejects invalid payload', async () => {
      const res = await testApp.app.inject({
        method: 'POST',
        url: '/api/known-failures',
        payload: { testTitle: '', testFile: '' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('Invalid body');
    });

    it('GET after POST includes created known failure', async () => {
      await testApp.app.inject({
        method: 'POST',
        url: '/api/known-failures',
        payload: {
          testTitle: 'fails always',
          testFile: 'tests/always-fails.spec.ts',
          comment: 'legacy',
        },
      });

      const res = await testApp.app.inject({ method: 'GET', url: '/api/known-failures' });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toHaveLength(1);
      expect(res.json()[0]).toMatchObject({
        testTitle: 'fails always',
        testFile: 'tests/always-fails.spec.ts',
        comment: 'legacy',
      });
    });

    it('DELETE /api/known-failures/:id removes existing entry', async () => {
      const created = await testApp.app.inject({
        method: 'POST',
        url: '/api/known-failures',
        payload: {
          testTitle: 'delete known',
          testFile: 'tests/delete-known.spec.ts',
        },
      });
      const id = created.json().id as string;

      const delRes = await testApp.app.inject({ method: 'DELETE', url: `/api/known-failures/${id}` });

      expect(delRes.statusCode).toBe(204);

      const listRes = await testApp.app.inject({ method: 'GET', url: '/api/known-failures' });
      expect(listRes.json()).toEqual([]);
    });

    it('DELETE /api/known-failures/:id returns 404 when entry does not exist', async () => {
      const res = await testApp.app.inject({ method: 'DELETE', url: '/api/known-failures/missing' });

      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: 'Known failure entry not found' });
    });
  });

  describe('schedules routes', () => {
    it('GET /api/schedules returns empty list initially', async () => {
      const res = await testApp.app.inject({ method: 'GET', url: '/api/schedules' });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
    });

    it('POST /api/schedules creates schedule and triggers reload', async () => {
      const res = await testApp.app.inject({
        method: 'POST',
        url: '/api/schedules',
        payload: {
          cronExpr: '*/5 * * * *',
          enabled: false,
          runOptions: { grep: '@smoke' },
        },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({ cronExpr: '*/5 * * * *', enabled: false });
      expect(reloadMock).toHaveBeenCalledTimes(1);
    });

    it('POST /api/schedules defaults enabled=true in response when omitted', async () => {
      const res = await testApp.app.inject({
        method: 'POST',
        url: '/api/schedules',
        payload: { cronExpr: '0 * * * *' },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({ cronExpr: '0 * * * *', enabled: true });
    });

    it('POST /api/schedules rejects invalid payload', async () => {
      const res = await testApp.app.inject({
        method: 'POST',
        url: '/api/schedules',
        payload: { enabled: true },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('Invalid schedule');
      expect(reloadMock).not.toHaveBeenCalled();
    });

    it('PUT /api/schedules/:id updates schedule and triggers reload', async () => {
      const created = await testApp.app.inject({
        method: 'POST',
        url: '/api/schedules',
        payload: { cronExpr: '0 */6 * * *' },
      });
      const id = created.json().id as string;
      reloadMock.mockClear();

      const res = await testApp.app.inject({
        method: 'PUT',
        url: `/api/schedules/${id}`,
        payload: {
          cronExpr: '0 */12 * * *',
          enabled: false,
          runOptions: { project: 'chromium' },
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true });
      expect(reloadMock).toHaveBeenCalledTimes(1);
    });

    it('PUT /api/schedules/:id rejects invalid payload', async () => {
      const created = await testApp.app.inject({
        method: 'POST',
        url: '/api/schedules',
        payload: { cronExpr: '0 */6 * * *' },
      });
      const id = created.json().id as string;
      reloadMock.mockClear();

      const res = await testApp.app.inject({
        method: 'PUT',
        url: `/api/schedules/${id}`,
        payload: { enabled: 'yes' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('Invalid schedule');
      expect(reloadMock).not.toHaveBeenCalled();
    });

    it('DELETE /api/schedules/:id removes existing schedule', async () => {
      const created = await testApp.app.inject({
        method: 'POST',
        url: '/api/schedules',
        payload: { cronExpr: '0 1 * * *' },
      });
      const id = created.json().id as string;
      reloadMock.mockClear();

      const delRes = await testApp.app.inject({ method: 'DELETE', url: `/api/schedules/${id}` });

      expect(delRes.statusCode).toBe(204);
      expect(reloadMock).toHaveBeenCalledTimes(1);

      const listRes = await testApp.app.inject({ method: 'GET', url: '/api/schedules' });
      expect(listRes.json()).toEqual([]);
    });

    it('DELETE /api/schedules/:id returns 404 when schedule does not exist', async () => {
      const res = await testApp.app.inject({ method: 'DELETE', url: '/api/schedules/missing' });

      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: 'Schedule not found' });
      expect(reloadMock).not.toHaveBeenCalled();
    });
  });

  describe('workspaces routes', () => {
    it('GET /api/workspaces returns empty list initially', async () => {
      const res = await testApp.app.inject({ method: 'GET', url: '/api/workspaces' });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
    });

    it('POST /api/workspaces creates workspace', async () => {
      const res = await testApp.app.inject({
        method: 'POST',
        url: '/api/workspaces',
        payload: {
          name: 'Main Repo',
          configPath: '/repo/playwright.config.ts',
          testResultsDir: '/repo/test-results',
        },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({
        name: 'Main Repo',
        configPath: '/repo/playwright.config.ts',
        testResultsDir: '/repo/test-results',
      });
    });

    it('POST /api/workspaces rejects invalid payload', async () => {
      const res = await testApp.app.inject({
        method: 'POST',
        url: '/api/workspaces',
        payload: { name: '' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('Invalid body');
    });

    it('PUT /api/workspaces/:id updates workspace', async () => {
      const created = await testApp.app.inject({
        method: 'POST',
        url: '/api/workspaces',
        payload: {
          name: 'Before',
          configPath: '/before.config.ts',
        },
      });
      const id = created.json().id as string;

      const putRes = await testApp.app.inject({
        method: 'PUT',
        url: `/api/workspaces/${id}`,
        payload: {
          name: 'After',
          configPath: '/after.config.ts',
          testResultsDir: '/results',
        },
      });

      expect(putRes.statusCode).toBe(200);
      expect(putRes.json()).toEqual({ updated: true });

      const listRes = await testApp.app.inject({ method: 'GET', url: '/api/workspaces' });
      expect(listRes.json()[0]).toMatchObject({
        id,
        name: 'After',
        configPath: '/after.config.ts',
        testResultsDir: '/results',
      });
    });

    it('DELETE /api/workspaces/:id removes existing workspace', async () => {
      const created = await testApp.app.inject({
        method: 'POST',
        url: '/api/workspaces',
        payload: {
          name: 'Delete Workspace',
          configPath: '/delete.config.ts',
        },
      });
      const id = created.json().id as string;

      const delRes = await testApp.app.inject({ method: 'DELETE', url: `/api/workspaces/${id}` });

      expect(delRes.statusCode).toBe(200);
      expect(delRes.json()).toEqual({ deleted: true });
    });

    it('DELETE /api/workspaces/:id returns 404 when workspace does not exist', async () => {
      const res = await testApp.app.inject({ method: 'DELETE', url: '/api/workspaces/missing' });

      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: 'Workspace not found' });
    });
  });

  describe('categories and fingerprint-categories routes', () => {
    it('GET /api/categories returns empty list initially', async () => {
      const res = await testApp.app.inject({ method: 'GET', url: '/api/categories' });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
    });

    it('POST /api/categories creates category', async () => {
      const res = await testApp.app.inject({
        method: 'POST',
        url: '/api/categories',
        payload: { name: 'infra', color: '#123456' },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({ name: 'infra', color: '#123456' });
    });

    it('POST /api/categories rejects invalid payload', async () => {
      const res = await testApp.app.inject({
        method: 'POST',
        url: '/api/categories',
        payload: { name: '' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBeDefined();
    });

    it('PUT /api/categories/:id updates category', async () => {
      const created = await testApp.app.inject({
        method: 'POST',
        url: '/api/categories',
        payload: { name: 'qa', color: '#000000' },
      });
      const id = created.json().id as string;

      const putRes = await testApp.app.inject({
        method: 'PUT',
        url: `/api/categories/${id}`,
        payload: { name: 'platform', color: '#ffffff' },
      });

      expect(putRes.statusCode).toBe(200);
      expect(putRes.json()).toEqual({ ok: true });
    });

    it('DELETE /api/categories/:id removes existing category', async () => {
      const created = await testApp.app.inject({
        method: 'POST',
        url: '/api/categories',
        payload: { name: 'delete-cat', color: '#111111' },
      });
      const id = created.json().id as string;

      const delRes = await testApp.app.inject({ method: 'DELETE', url: `/api/categories/${id}` });

      expect(delRes.statusCode).toBe(200);
      expect(delRes.json()).toEqual({ ok: true });
    });

    it('DELETE /api/categories/:id returns 404 when category does not exist', async () => {
      const res = await testApp.app.inject({ method: 'DELETE', url: '/api/categories/missing' });

      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: 'Category not found' });
    });

    it('GET /api/fingerprint-categories returns empty list initially', async () => {
      const res = await testApp.app.inject({ method: 'GET', url: '/api/fingerprint-categories' });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
    });

    it('PUT /api/fingerprint-categories/:fingerprint assigns fingerprint to category', async () => {
      const categoryRes = await testApp.app.inject({
        method: 'POST',
        url: '/api/categories',
        payload: { name: 'network', color: '#aaaaaa' },
      });
      const categoryId = categoryRes.json().id as string;

      const assignRes = await testApp.app.inject({
        method: 'PUT',
        url: '/api/fingerprint-categories/fp-123',
        payload: { categoryId },
      });

      expect(assignRes.statusCode).toBe(200);
      expect(assignRes.json()).toEqual({ ok: true });
    });

    it('GET /api/fingerprint-categories shows assignment', async () => {
      const categoryRes = await testApp.app.inject({
        method: 'POST',
        url: '/api/categories',
        payload: { name: 'ui', color: '#bbbbbb' },
      });
      const categoryId = categoryRes.json().id as string;

      await testApp.app.inject({
        method: 'PUT',
        url: '/api/fingerprint-categories/fp-xyz',
        payload: { categoryId },
      });

      const listRes = await testApp.app.inject({ method: 'GET', url: '/api/fingerprint-categories' });

      expect(listRes.statusCode).toBe(200);
      expect(listRes.json()).toEqual([
        {
          fingerprint: 'fp-xyz',
          categoryId,
          assignedAt: expect.any(String),
        },
      ]);
    });

    it('DELETE /api/fingerprint-categories/:fingerprint removes assignment', async () => {
      const categoryRes = await testApp.app.inject({
        method: 'POST',
        url: '/api/categories',
        payload: { name: 'backend', color: '#cccccc' },
      });
      const categoryId = categoryRes.json().id as string;

      await testApp.app.inject({
        method: 'PUT',
        url: '/api/fingerprint-categories/fp-delete',
        payload: { categoryId },
      });

      const delRes = await testApp.app.inject({ method: 'DELETE', url: '/api/fingerprint-categories/fp-delete' });

      expect(delRes.statusCode).toBe(200);
      expect(delRes.json()).toEqual({ ok: true });
    });

    it('DELETE /api/fingerprint-categories/:fingerprint returns 404 when assignment does not exist', async () => {
      const res = await testApp.app.inject({ method: 'DELETE', url: '/api/fingerprint-categories/missing' });

      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: 'Fingerprint category assignment not found' });
    });
  });

  describe('gate config routes', () => {
    it('GET /api/gate-config returns default config initially', async () => {
      const res = await testApp.app.inject({ method: 'GET', url: '/api/gate-config' });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        id: 'global',
        passRateThreshold: 100,
        maxDurationMs: null,
        maxFlakyCount: null,
      });
    });

    it('PUT /api/gate-config updates thresholds', async () => {
      const res = await testApp.app.inject({
        method: 'PUT',
        url: '/api/gate-config',
        payload: {
          passRateThreshold: 92.5,
          maxDurationMs: 120000,
          maxFlakyCount: 3,
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true });
    });

    it('GET /api/gate-config returns updated config after PUT', async () => {
      await testApp.app.inject({
        method: 'PUT',
        url: '/api/gate-config',
        payload: {
          passRateThreshold: 87,
          maxDurationMs: 90000,
          maxFlakyCount: 4,
        },
      });

      const res = await testApp.app.inject({ method: 'GET', url: '/api/gate-config' });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        id: 'global',
        passRateThreshold: 87,
        maxDurationMs: 90000,
        maxFlakyCount: 4,
      });
    });
  });
});
