import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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

describe('locator-suggestions routes', () => {
  beforeAll(async () => {
    testApp = await createTestApp();
    const { locatorSuggestionsRoutes } = await import('../locator-suggestions.js');
    await locatorSuggestionsRoutes(testApp.app);
    await testApp.app.ready();
  });

  beforeEach(() => {
    testApp.poolConnection.exec('DELETE FROM locator_suggestions');
    testApp.poolConnection.exec(`
      INSERT INTO runs (id, started_at, status, total, passed, failed, flaky, skipped)
      VALUES ('run-ls-1', '2024-01-01T00:00:00.000Z', 'failed', 1, 0, 1, 0, 0)
      ON CONFLICT DO NOTHING
    `);
  });

  afterAll(async () => {
    await testApp.app.close();
    testApp.poolConnection.close();
  });

  // ── GET /api/locator-suggestions ──────────────────────────────────────────

  it('GET /api/locator-suggestions returns empty array initially', async () => {
    const res = await testApp.app.inject({ method: 'GET', url: '/api/locator-suggestions' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('GET /api/locator-suggestions with testId filter returns matching rows', async () => {
    testApp.poolConnection.exec(`
      INSERT INTO locator_suggestions (id, test_id, run_id, original_selector, suggested_selector, confidence, rationale, status, created_at)
      VALUES
        ('sug-1', 'test-abc', 'run-ls-1', '.btn', '[data-testid="btn"]', 0.85, 'token overlap', 'pending', '2024-01-01T00:00:00.000Z'),
        ('sug-2', 'test-xyz', 'run-ls-1', '.foo', '[aria-label="foo"]', 0.75, 'aria label', 'pending', '2024-01-01T00:00:00.000Z')
    `);

    const res = await testApp.app.inject({
      method: 'GET',
      url: '/api/locator-suggestions?testId=test-abc',
    });

    expect(res.statusCode).toBe(200);
    const rows = res.json() as Array<{ id: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('sug-1');
  });

  it('GET /api/locator-suggestions with runId filter returns matching rows', async () => {
    testApp.poolConnection.exec(`
      INSERT INTO runs (id, started_at, status, total, passed, failed, flaky, skipped)
      VALUES ('run-ls-2', '2024-01-01T00:00:00.000Z', 'failed', 1, 0, 1, 0, 0)
      ON CONFLICT DO NOTHING
    `);
    testApp.poolConnection.exec(`
      INSERT INTO locator_suggestions (id, test_id, run_id, original_selector, suggested_selector, confidence, rationale, status, created_at)
      VALUES
        ('sug-3', 'test-111', 'run-ls-1', '.a', '.b', 0.8, 'r', 'pending', '2024-01-01T00:00:00.000Z'),
        ('sug-4', 'test-222', 'run-ls-2', '.c', '.d', 0.9, 'r', 'pending', '2024-01-01T00:00:00.000Z')
    `);

    const res = await testApp.app.inject({
      method: 'GET',
      url: '/api/locator-suggestions?runId=run-ls-2',
    });

    expect(res.statusCode).toBe(200);
    const rows = res.json() as Array<{ id: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('sug-4');
  });

  it('GET /api/locator-suggestions with non-matching testId returns empty array', async () => {
    const res = await testApp.app.inject({
      method: 'GET',
      url: '/api/locator-suggestions?testId=non-existent-test',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('GET /api/locator-suggestions with both testId and runId filters', async () => {
    testApp.poolConnection.exec(`
      INSERT INTO locator_suggestions (id, test_id, run_id, original_selector, suggested_selector, confidence, rationale, status, created_at)
      VALUES
        ('sug-5', 'test-match', 'run-ls-1', '.x', '.y', 0.8, 'r', 'pending', '2024-01-01T00:00:00.000Z'),
        ('sug-6', 'test-match', 'run-ls-1', '.p', '.q', 0.7, 'r', 'pending', '2024-01-01T00:00:00.000Z')
    `);

    const res = await testApp.app.inject({
      method: 'GET',
      url: '/api/locator-suggestions?testId=test-match&runId=run-ls-1',
    });

    expect(res.statusCode).toBe(200);
    const rows = res.json() as Array<{ id: string }>;
    expect(rows).toHaveLength(2);
  });

  // ── PUT /api/locator-suggestions/:id/accept ───────────────────────────────

  it('PUT /:id/accept sets status to accepted and returns 200', async () => {
    testApp.poolConnection.exec(`
      INSERT INTO locator_suggestions (id, test_id, run_id, original_selector, suggested_selector, confidence, rationale, status, created_at)
      VALUES ('sug-acc', 'test-t1', 'run-ls-1', '.old', '.new', 0.9, 'good match', 'pending', '2024-01-01T00:00:00.000Z')
    `);

    const res = await testApp.app.inject({
      method: 'PUT',
      url: '/api/locator-suggestions/sug-acc/accept',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { id: string; status: string };
    expect(body.id).toBe('sug-acc');
    expect(body.status).toBe('accepted');

    // Verify in DB
    const row = testApp.poolConnection.prepare('SELECT status FROM locator_suggestions WHERE id = ?').get('sug-acc') as { status: string } | undefined;
    expect(row?.status).toBe('accepted');
  });

  it('PUT /:id/reject sets status to rejected and returns 200', async () => {
    testApp.poolConnection.exec(`
      INSERT INTO locator_suggestions (id, test_id, run_id, original_selector, suggested_selector, confidence, rationale, status, created_at)
      VALUES ('sug-rej', 'test-t2', 'run-ls-1', '.old2', '.new2', 0.7, 'low confidence', 'pending', '2024-01-01T00:00:00.000Z')
    `);

    const res = await testApp.app.inject({
      method: 'PUT',
      url: '/api/locator-suggestions/sug-rej/reject',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { id: string; status: string };
    expect(body.id).toBe('sug-rej');
    expect(body.status).toBe('rejected');
  });

  it('PUT /:id/accept returns 404 for non-existent id', async () => {
    const res = await testApp.app.inject({
      method: 'PUT',
      url: '/api/locator-suggestions/does-not-exist/accept',
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: 'Suggestion not found' });
  });

  it('PUT /:id/reject returns 404 for non-existent id', async () => {
    const res = await testApp.app.inject({
      method: 'PUT',
      url: '/api/locator-suggestions/no-such-id/reject',
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: 'Suggestion not found' });
  });
});
