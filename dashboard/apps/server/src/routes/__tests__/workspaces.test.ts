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

describe('workspaces routes', () => {
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

  it('GET /api/workspaces returns empty list initially', async () => {
    const res = await testApp.app.inject({ method: 'GET', url: '/api/workspaces' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('GET /api/workspaces returns rows after insert', async () => {
    const row = fixtures.workspace({ name: 'Repo A', configPath: '/repo-a/playwright.config.ts' });
    testApp.sqlite
      .prepare('INSERT INTO workspaces (id, name, config_path, test_results_dir, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(row.id, row.name, row.configPath, row.testResultsDir, row.createdAt);

    const res = await testApp.app.inject({ method: 'GET', url: '/api/workspaces' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      {
        id: row.id,
        name: 'Repo A',
        configPath: '/repo-a/playwright.config.ts',
        testResultsDir: null,
        createdAt: row.createdAt,
      },
    ]);
  });

  it('POST /api/workspaces creates workspace and returns id', async () => {
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/workspaces',
      payload: {
        name: 'Main Repo',
        configPath: '/workspace/playwright.config.ts',
        testResultsDir: '/workspace/test-results',
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.name).toBe('Main Repo');
    expect(body.configPath).toBe('/workspace/playwright.config.ts');
    expect(body.testResultsDir).toBe('/workspace/test-results');
    expect(typeof body.id).toBe('string');

    const rows = testApp.sqlite
      .prepare('SELECT id, name, config_path, test_results_dir FROM workspaces WHERE id = ?')
      .all(body.id);
    expect(rows).toEqual([
      {
        id: body.id,
        name: 'Main Repo',
        config_path: '/workspace/playwright.config.ts',
        test_results_dir: '/workspace/test-results',
      },
    ]);
  });

  it('POST /api/workspaces rejects invalid body when name is missing', async () => {
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/workspaces',
      payload: { configPath: '/workspace/playwright.config.ts' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('Invalid body');
  });

  it('POST /api/workspaces rejects invalid body when configPath is missing', async () => {
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/workspaces',
      payload: { name: 'Main Repo' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('Invalid body');
  });

  it('PUT /api/workspaces/:id updates workspace fields', async () => {
    const row = fixtures.workspace({ name: 'Before', configPath: '/before.config.ts' });
    testApp.sqlite
      .prepare('INSERT INTO workspaces (id, name, config_path, test_results_dir, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(row.id, row.name, row.configPath, row.testResultsDir, row.createdAt);

    const updateRes = await testApp.app.inject({
      method: 'PUT',
      url: `/api/workspaces/${row.id}`,
      payload: {
        name: 'After',
        configPath: '/after.config.ts',
        testResultsDir: '/after-results',
      },
    });

    expect(updateRes.statusCode).toBe(200);
    expect(updateRes.json()).toEqual({ updated: true });

    const listRes = await testApp.app.inject({ method: 'GET', url: '/api/workspaces' });
    expect(listRes.json()).toEqual([
      {
        id: row.id,
        name: 'After',
        configPath: '/after.config.ts',
        testResultsDir: '/after-results',
        createdAt: row.createdAt,
      },
    ]);
  });

  it('PUT /api/workspaces/:id rejects invalid body', async () => {
    const row = fixtures.workspace();
    testApp.sqlite
      .prepare('INSERT INTO workspaces (id, name, config_path, test_results_dir, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(row.id, row.name, row.configPath, row.testResultsDir, row.createdAt);

    const res = await testApp.app.inject({
      method: 'PUT',
      url: `/api/workspaces/${row.id}`,
      payload: { name: '' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'Invalid body' });
  });

  it('DELETE /api/workspaces/:id deletes workspace', async () => {
    const row = fixtures.workspace();
    testApp.sqlite
      .prepare('INSERT INTO workspaces (id, name, config_path, test_results_dir, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(row.id, row.name, row.configPath, row.testResultsDir, row.createdAt);

    const delRes = await testApp.app.inject({
      method: 'DELETE',
      url: `/api/workspaces/${row.id}`,
    });

    expect(delRes.statusCode).toBe(200);
    expect(delRes.json()).toEqual({ deleted: true });

    const listRes = await testApp.app.inject({ method: 'GET', url: '/api/workspaces' });
    expect(listRes.json()).toEqual([]);
  });

  // ── Gate config endpoints ─────────────────────────────────────────────────

  describe('GET /api/workspaces/:id/gate-config', () => {
    beforeEach(() => {
      testApp.poolConnection.exec('DELETE FROM quality_gate_config');
    });

    it('returns workspace-specific config when it exists', async () => {
      testApp.poolConnection.exec(`
        INSERT INTO quality_gate_config (id, workspace_id, pass_rate_threshold, max_quarantine_percent, updated_at)
        VALUES ('ws-a', 'ws-a', 95, 10, '2026-01-01T00:00:00Z')
      `);

      const res = await testApp.app.inject({ method: 'GET', url: '/api/workspaces/ws-a/gate-config' });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.passRateThreshold).toBe(95);
      expect(body.maxQuarantinePercent).toBe(10);
      expect(body.isGlobalFallback).toBeUndefined();
    });

    it('falls back to global config when workspace config does not exist', async () => {
      testApp.poolConnection.exec(`
        INSERT INTO quality_gate_config (id, workspace_id, pass_rate_threshold, updated_at)
        VALUES ('global', NULL, 90, '2026-01-01T00:00:00Z')
      `);

      const res = await testApp.app.inject({ method: 'GET', url: '/api/workspaces/ws-no-config/gate-config' });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.passRateThreshold).toBe(90);
      expect(body.isGlobalFallback).toBe(true);
    });

    it('returns defaults when no config exists at all', async () => {
      const res = await testApp.app.inject({ method: 'GET', url: '/api/workspaces/ws-empty/gate-config' });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.passRateThreshold).toBe(100);
      expect(body.isGlobalFallback).toBe(true);
    });
  });

  describe('PUT /api/workspaces/:id/gate-config', () => {
    beforeEach(() => {
      testApp.poolConnection.exec('DELETE FROM quality_gate_config');
    });

    it('creates workspace gate config when none exists', async () => {
      const res = await testApp.app.inject({
        method: 'PUT',
        url: '/api/workspaces/ws-new/gate-config',
        payload: { passRateThreshold: 95, maxQuarantinePercent: 10 },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.passRateThreshold).toBe(95);
      expect(body.maxQuarantinePercent).toBe(10);
      expect(body.workspaceId).toBe('ws-new');
    });

    it('updates existing workspace gate config', async () => {
      testApp.poolConnection.exec(`
        INSERT INTO quality_gate_config (id, workspace_id, pass_rate_threshold, updated_at)
        VALUES ('ws-upd', 'ws-upd', 90, '2026-01-01T00:00:00Z')
      `);

      const res = await testApp.app.inject({
        method: 'PUT',
        url: '/api/workspaces/ws-upd/gate-config',
        payload: { passRateThreshold: 99 },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().passRateThreshold).toBe(99);
    });

    it('rejects invalid body (passRateThreshold out of range)', async () => {
      const res = await testApp.app.inject({
        method: 'PUT',
        url: '/api/workspaces/ws-bad/gate-config',
        payload: { passRateThreshold: 150 },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('Invalid body');
    });

    it('accepts null for optional thresholds', async () => {
      const res = await testApp.app.inject({
        method: 'PUT',
        url: '/api/workspaces/ws-nulls/gate-config',
        payload: { maxDurationMs: null, maxFlakyCount: null, maxQuarantinePercent: null },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.maxDurationMs).toBeNull();
      expect(body.maxFlakyCount).toBeNull();
      expect(body.maxQuarantinePercent).toBeNull();
    });
  });
});
