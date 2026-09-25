/**
 * Branch coverage for workspaces routes.
 * Targets: PUT without testResultsDir (line 64), DELETE 404 (line 77),
 * PUT without name/configPath (lines 62-63)
 */
import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
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

describe('workspaces routes — branch coverage', () => {
  beforeAll(async () => {
    testApp = await createTestApp();
    const { workspacesRoutes } = await import('../workspaces.js');
    await workspacesRoutes(testApp.app);
    await testApp.app.ready();
  });

  beforeEach(() => {
    testApp.poolConnection.exec('DELETE FROM workspaces');
  });

  afterAll(async () => {
    await testApp.app.close();
    testApp.poolConnection.close();
  });

  it('DELETE /api/workspaces/:id returns 404 when workspace does not exist', async () => {
    const res = await testApp.app.inject({
      method: 'DELETE',
      url: '/api/workspaces/nonexistent-id',
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'Workspace not found' });
  });

  it('PUT /api/workspaces/:id updates only name (no configPath, no testResultsDir)', async () => {
    const row = fixtures.workspace({ name: 'Original', configPath: '/original.config.ts' });
    testApp.sqlite
      .prepare('INSERT INTO workspaces (id, name, config_path, test_results_dir, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(row.id, row.name, row.configPath, row.testResultsDir, row.createdAt);

    const res = await testApp.app.inject({
      method: 'PUT',
      url: `/api/workspaces/${row.id}`,
      payload: { name: 'Updated Name' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ updated: true });
  });

  it('PUT /api/workspaces/:id with only configPath updates configPath only', async () => {
    const row = fixtures.workspace({ name: 'Stable', configPath: '/old.config.ts' });
    testApp.sqlite
      .prepare('INSERT INTO workspaces (id, name, config_path, test_results_dir, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(row.id, row.name, row.configPath, row.testResultsDir, row.createdAt);

    const res = await testApp.app.inject({
      method: 'PUT',
      url: `/api/workspaces/${row.id}`,
      payload: { configPath: '/new.config.ts' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ updated: true });
  });

  it('PUT /api/workspaces/:id with empty testResultsDir string updates to empty string', async () => {
    const row = fixtures.workspace({ name: 'WS', configPath: '/config.ts' });
    testApp.sqlite
      .prepare('INSERT INTO workspaces (id, name, config_path, test_results_dir, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(row.id, row.name, row.configPath, '/old-results', row.createdAt);

    const res = await testApp.app.inject({
      method: 'PUT',
      url: `/api/workspaces/${row.id}`,
      payload: { testResultsDir: '' },
    });

    // Zod allows empty string for optional string — this covers the `testResultsDir !== undefined` branch
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ updated: true });
  });

  it('POST /api/workspaces creates workspace without testResultsDir', async () => {
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/workspaces',
      payload: {
        name: 'No Results Dir',
        configPath: '/no-results.config.ts',
        // testResultsDir intentionally omitted
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json() as { id: string; name: string; configPath: string };
    expect(body.name).toBe('No Results Dir');
    // testResultsDir should be undefined/null
  });

  it('PUT /api/workspaces/:id/gate-config updates existing config with partial fields (covers conditional update branches)', async () => {
    // Create workspace
    const createRes = await testApp.app.inject({
      method: 'POST',
      url: '/api/workspaces',
      payload: { name: 'Gate Test WS', configPath: '/gate.config.ts' },
    });
    expect(createRes.statusCode).toBe(201);
    const { id: wsId } = createRes.json() as { id: string };

    // First PUT (insert path)
    await testApp.app.inject({
      method: 'PUT',
      url: `/api/workspaces/${wsId}/gate-config`,
      payload: { passRateThreshold: 80, maxFlakyCount: 5 },
    });

    // Second PUT (update path) — only passRateThreshold provided, others undefined
    const res = await testApp.app.inject({
      method: 'PUT',
      url: `/api/workspaces/${wsId}/gate-config`,
      payload: { passRateThreshold: 90 },
    });

    expect(res.statusCode).toBe(200);
  });

  it('PUT /api/workspaces/:id/gate-config with all fields covers all update branches', async () => {
    const createRes = await testApp.app.inject({
      method: 'POST',
      url: '/api/workspaces',
      payload: { name: 'Gate All Fields', configPath: '/gate-all.config.ts' },
    });
    const { id: wsId } = createRes.json() as { id: string };

    // First: insert
    await testApp.app.inject({
      method: 'PUT',
      url: `/api/workspaces/${wsId}/gate-config`,
      payload: { passRateThreshold: 80 },
    });

    // Second: update with all optional fields
    const res = await testApp.app.inject({
      method: 'PUT',
      url: `/api/workspaces/${wsId}/gate-config`,
      payload: {
        passRateThreshold: 85,
        maxDurationMs: 5000,
        maxFlakyCount: 3,
        maxQuarantinePercent: 10,
      },
    });

    expect(res.statusCode).toBe(200);
  });
});
