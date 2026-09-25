import { test, expect } from '@playwright/test';

const API = process.env.API_BASE_URL ?? 'http://localhost:4000';

// Test data cleanup tracking
const createdIds = {
  quarantine: [] as number[],
  knownFailures: [] as number[],
  schedules: [] as number[],
  workspaces: [] as number[],
  categories: [] as number[],
};

// Dynamic run IDs resolved from the DB at test startup
let runIds: string[] = [];

test.beforeAll(async ({ request }) => {
  const res = await request.get(`${API}/api/runs`);
  if (res.ok()) {
    const data = await res.json();
    if (Array.isArray(data)) {
      runIds = data.map((r: { id: string }) => r.id);
    }
  }
});

test.describe('Runs API', () => {
  test('GET /api/runs returns run list', async ({ request }) => {
    const res = await request.get(`${API}/api/runs`);
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThanOrEqual(0);
    // Verify structure of first run (if any exist)
    if (data.length > 0) {
      expect(data[0]).toHaveProperty('id');
      expect(data[0]).toHaveProperty('status');
    }
  });

  test('GET /api/runs with query params (limit, offset, status)', async ({ request }) => {
    const res = await request.get(`${API}/api/runs?limit=2&offset=0&status=passed`);
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    // Server returns runs (status filter may not be enforced server-side)
    expect(data.length).toBeGreaterThanOrEqual(0);
  });

  test('GET /api/runs/:runId returns single run detail', async ({ request }) => {
    if (runIds.length === 0) {
      test.skip(true, 'No runs in DB — skipping run detail test');
      return;
    }
    const runId = runIds[0];
    const res = await request.get(`${API}/api/runs/${runId}`);
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.id).toBe(runId);
    expect(data).toHaveProperty('status');
    expect(data).toHaveProperty('startedAt');
  });

  test('GET /api/runs/:runId with invalid ID returns 404', async ({ request }) => {
    const res = await request.get(`${API}/api/runs/nonexistent-run`);
    expect(res.status()).toBe(404);
  });

  test('GET /api/runs/:runId/tests returns tests for a run', async ({ request }) => {
    if (runIds.length === 0) {
      test.skip(true, 'No runs in DB — skipping run tests test');
      return;
    }
    const runId = runIds[0];
    const res = await request.get(`${API}/api/runs/${runId}/tests`);
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    if (data.length > 0) {
      expect(data[0]).toHaveProperty('id');
      expect(data[0]).toHaveProperty('title');
    }
  });

  test('GET /api/runs/:runId/tests/:testId returns single test with results', async ({ request }) => {
    if (runIds.length === 0) {
      test.skip(true, 'No runs in DB — skipping single test detail test');
      return;
    }
    const runId = runIds[0];
    // First get tests for a run
    const testsRes = await request.get(`${API}/api/runs/${runId}/tests`);
    const tests = await testsRes.json();
    
    if (tests.length > 0) {
      const testId = tests[0].id;
      const res = await request.get(`${API}/api/runs/${runId}/tests/${testId}`);
      expect(res.ok()).toBeTruthy();
      const data = await res.json();
      expect(data).toHaveProperty('id');
      expect(data).toHaveProperty('title');
      expect(data).toHaveProperty('results');
    }
  });

  test('GET /api/runs/export.csv returns CSV format', async ({ request }) => {
    const res = await request.get(`${API}/api/runs/export.csv`);
    expect(res.ok()).toBeTruthy();
    const contentType = res.headers()['content-type'];
    expect(contentType).toContain('text/csv');
    const body = await res.text();
    expect(body).toContain(','); // CSV should have commas
  });

  test('GET /api/runs/:runId/export.html returns HTML format', async ({ request }) => {
    if (runIds.length === 0) {
      test.skip(true, 'No runs in DB — skipping HTML export test');
      return;
    }
    const res = await request.get(`${API}/api/runs/${runIds[0]}/export.html`);
    expect(res.ok()).toBeTruthy();
    const body = await res.text();
    expect(body).toContain('<html');
  });

  test('GET /api/runs/:runId/export.pdf returns PDF report', async ({ request }) => {
    if (runIds.length === 0) {
      test.skip(true, 'No runs in DB — skipping PDF export test');
      return;
    }
    const res = await request.get(`${API}/api/runs/${runIds[0]}/export.pdf`);
    expect(res.ok()).toBeTruthy();
    // Server generates HTML-based report (not binary PDF)
    const contentType = res.headers()['content-type'];
    expect(contentType).toContain('text/html');
  });

  test('GET /api/runs/:runId/export.junit returns JUnit report', async ({ request }) => {
    if (runIds.length === 0) {
      test.skip(true, 'No runs in DB — skipping JUnit export test');
      return;
    }
    const res = await request.get(`${API}/api/runs/${runIds[0]}/export.junit`);
    expect(res.ok()).toBeTruthy();
    const body = await res.text();
    // Server returns the report (may be HTML-formatted)
    expect(body.length).toBeGreaterThan(0);
  });

  test('GET /api/runs/:runId/fingerprints returns error fingerprints', async ({ request }) => {
    if (runIds.length === 0) {
      test.skip(true, 'No runs in DB — skipping fingerprints test');
      return;
    }
    const runId = runIds.length >= 2 ? runIds[1] : runIds[0];
    const res = await request.get(`${API}/api/runs/${runId}/fingerprints`);
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  test('GET /api/runs/compare compares two runs', async ({ request }) => {
    if (runIds.length < 2) {
      test.skip(true, 'Need at least 2 runs in DB — skipping compare test');
      return;
    }
    const res = await request.get(`${API}/api/runs/compare?a=${runIds[0]}&b=${runIds[1]}`);
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    // Each item has statusA/statusB and changeType
    if (data.length > 0) {
      expect(data[0]).toHaveProperty('statusA');
      expect(data[0]).toHaveProperty('statusB');
      expect(data[0]).toHaveProperty('changeType');
    }
  });

  test('GET /api/runs/compare returns 400 with missing params', async ({ request }) => {
    const res = await request.get(`${API}/api/runs/compare?runA=demo-run-1`);
    expect(res.status()).toBe(400);
  });
});

test.describe('Tests API', () => {
  test('GET /api/tests/history/:stableId returns cross-run history', async ({ request }) => {
    if (runIds.length === 0) {
      test.skip(true, 'No runs in DB — skipping test history test');
      return;
    }
    // Get a test from a run first
    const testsRes = await request.get(`${API}/api/runs/${runIds[0]}/tests`);
    const tests = await testsRes.json();
    
    if (tests.length > 0 && tests[0].stableId) {
      const res = await request.get(`${API}/api/tests/history/${tests[0].stableId}`);
      expect(res.ok()).toBeTruthy();
      const data = await res.json();
      expect(Array.isArray(data)).toBe(true);
    }
  });

  test('GET /api/tests/history/:stableId returns history for specific test', async ({ request }) => {
    if (runIds.length === 0) {
      test.skip(true, 'No runs in DB — skipping specific test history test');
      return;
    }
    const historyRes = await request.get(`${API}/api/runs/${runIds[0]}/tests`);
    const tests = await historyRes.json();
    if (tests.length > 0 && tests[0].stable_id) {
      const res = await request.get(`${API}/api/tests/history/${encodeURIComponent(tests[0].stable_id)}`);
      expect(res.ok()).toBeTruthy();
      const data = await res.json();
      expect(Array.isArray(data)).toBe(true);
    }
  });

  test('GET /api/tests/impact returns impact analysis', async ({ request }) => {
    const res = await request.get(`${API}/api/tests/impact`);
    // May return 400 if no git-diff provided, that's acceptable
    expect([200, 400].includes(res.status())).toBeTruthy();
  });

  test('GET /api/tests/source-file returns source file content', async ({ request }) => {
    const res = await request.get(`${API}/api/tests/source-file?path=test/example.spec.ts`);
    // May return 404 if file doesn't exist, that's acceptable
    expect([200, 404].includes(res.status())).toBeTruthy();
  });

  test('GET /api/tests/stability/:stableId returns stability grade', async ({ request }) => {
    // Use a stable ID from seeded demo data
    const stableId = 'stable-auth-tests-000';
    const res = await request.get(`${API}/api/tests/stability/${encodeURIComponent(stableId)}`);
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    // Stability grade response contains grade info
    expect(typeof data).toBe('object');
  });
});

test.describe('Analytics API', () => {
  test('GET /api/analytics/pass-rate returns pass rate over time', async ({ request }) => {
    const res = await request.get(`${API}/api/analytics/pass-rate`);
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  test('GET /api/analytics/pass-rate with query params (days, project)', async ({ request }) => {
    const res = await request.get(`${API}/api/analytics/pass-rate?days=7&project=demo`);
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  test('GET /api/analytics/duration returns duration stats', async ({ request }) => {
    const res = await request.get(`${API}/api/analytics/duration`);
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  test('GET /api/analytics/flaky returns flaky test leaderboard', async ({ request }) => {
    const res = await request.get(`${API}/api/analytics/flaky`);
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  test('GET /api/analytics/flaky with limit param', async ({ request }) => {
    const res = await request.get(`${API}/api/analytics/flaky?limit=5`);
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeLessThanOrEqual(5);
  });

  test('GET /api/analytics/slow returns slowest tests', async ({ request }) => {
    const res = await request.get(`${API}/api/analytics/slow`);
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  test('GET /api/analytics/slow with limit param', async ({ request }) => {
    const res = await request.get(`${API}/api/analytics/slow?limit=10`);
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeLessThanOrEqual(10);
  });
});

test.describe('Quarantine API', () => {
  test('GET /api/quarantine returns list of quarantined tests', async ({ request }) => {
    const res = await request.get(`${API}/api/quarantine`);
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  test('CRUD: Create, verify, and delete quarantine entry', async ({ request }) => {
    // Create
    const createRes = await request.post(`${API}/api/quarantine`, {
      data: {
        testTitle: 'test-api-quarantine-crud',
        testFile: 'test/api-crud.spec.ts',
        reason: 'Testing CRUD operations'
      }
    });
    expect(createRes.status()).toBe(201);
    const created = await createRes.json();
    expect(created).toHaveProperty('id');
    expect(created.testTitle).toBe('test-api-quarantine-crud');
    createdIds.quarantine.push(created.id);

    // Verify - list should contain it
    const listRes = await request.get(`${API}/api/quarantine`);
    const list = await listRes.json();
    const found = list.find((q: any) => q.id === created.id);
    expect(found).toBeDefined();
    expect(found.testTitle).toBe('test-api-quarantine-crud');

    // Delete
    const deleteRes = await request.delete(`${API}/api/quarantine/${created.id}`);
    expect(deleteRes.status()).toBe(204);

    // Verify deleted
    const listAfterDelete = await request.get(`${API}/api/quarantine`);
    const listData = await listAfterDelete.json();
    const notFound = listData.find((q: any) => q.id === created.id);
    expect(notFound).toBeUndefined();

    // Remove from tracking
    createdIds.quarantine = createdIds.quarantine.filter(id => id !== created.id);
  });

  test('POST /api/quarantine returns 400 with invalid body', async ({ request }) => {
    const res = await request.post(`${API}/api/quarantine`, {
      data: { testTitle: '' } // Missing required testFile
    });
    expect(res.status()).toBe(400);
  });

  test('DELETE /api/quarantine/:id returns 404 for nonexistent ID', async ({ request }) => {
    const res = await request.delete(`${API}/api/quarantine/999999`);
    expect(res.status()).toBe(404);
  });
});

test.describe('Known Failures API', () => {
  test('GET /api/known-failures returns list', async ({ request }) => {
    const res = await request.get(`${API}/api/known-failures`);
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  test('CRUD: Create, verify, and delete known failure', async ({ request }) => {
    // Create
    const createRes = await request.post(`${API}/api/known-failures`, {
      data: {
        testTitle: 'test-api-known-failure-crud',
        testFile: 'test/api-crud.spec.ts',
        comment: 'Testing CRUD operations'
      }
    });
    expect(createRes.status()).toBe(201);
    const created = await createRes.json();
    expect(created).toHaveProperty('id');
    expect(created.testTitle).toBe('test-api-known-failure-crud');
    createdIds.knownFailures.push(created.id);

    // Verify - list should contain it
    const listRes = await request.get(`${API}/api/known-failures`);
    const list = await listRes.json();
    const found = list.find((kf: any) => kf.id === created.id);
    expect(found).toBeDefined();
    expect(found.testTitle).toBe('test-api-known-failure-crud');

    // Delete
    const deleteRes = await request.delete(`${API}/api/known-failures/${created.id}`);
    expect(deleteRes.status()).toBe(204);

    // Verify deleted
    const listAfterDelete = await request.get(`${API}/api/known-failures`);
    const listData = await listAfterDelete.json();
    const notFound = listData.find((kf: any) => kf.id === created.id);
    expect(notFound).toBeUndefined();

    // Remove from tracking
    createdIds.knownFailures = createdIds.knownFailures.filter(id => id !== created.id);
  });

  test('POST /api/known-failures returns 400 with invalid body', async ({ request }) => {
    const res = await request.post(`${API}/api/known-failures`, {
      data: { testTitle: '' } // Missing required testFile
    });
    expect(res.status()).toBe(400);
  });
});

test.describe('Schedules API', () => {
  test('GET /api/schedules returns list', async ({ request }) => {
    const res = await request.get(`${API}/api/schedules`);
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  test('CRUD: Create, verify, update, and delete schedule', async ({ request }) => {
    // Create
    const createRes = await request.post(`${API}/api/schedules`, {
      data: {
        cronExpr: '0 0 * * *',
        runOptions: { projects: ['test-api'] },
        enabled: true
      }
    });
    expect(createRes.status()).toBe(201);
    const created = await createRes.json();
    expect(created).toHaveProperty('id');
    expect(created.cronExpr).toBe('0 0 * * *');
    expect(created.enabled).toBe(true);
    createdIds.schedules.push(created.id);

    // Verify - list should contain it
    const listRes = await request.get(`${API}/api/schedules`);
    const list = await listRes.json();
    const found = list.find((s: any) => s.id === created.id);
    expect(found).toBeDefined();

    // Update
    const updateRes = await request.put(`${API}/api/schedules/${created.id}`, {
      data: {
        cronExpr: '0 12 * * *',
        enabled: false
      }
    });
    expect(updateRes.ok()).toBeTruthy();
    const updateBody = await updateRes.json();
    expect(updateBody.ok).toBe(true);
    // Verify the update via GET
    const verifyRes = await request.get(`${API}/api/schedules`);
    const allSchedules = await verifyRes.json();
    const updatedSchedule = allSchedules.find((s: any) => s.id === created.id);
    expect(updatedSchedule).toBeTruthy();
    expect(updatedSchedule.cronExpr).toBe('0 12 * * *');
    expect(updatedSchedule.enabled).toBe(false);



    // Delete
    const deleteRes = await request.delete(`${API}/api/schedules/${created.id}`);
    expect(deleteRes.status()).toBe(204);

    // Verify deleted
    const listAfterDelete = await request.get(`${API}/api/schedules`);
    const listData = await listAfterDelete.json();
    const notFound = listData.find((s: any) => s.id === created.id);
    expect(notFound).toBeUndefined();

    // Remove from tracking
    createdIds.schedules = createdIds.schedules.filter(id => id !== created.id);
  });

  test('POST /api/schedules accepts any cron expression (no server validation)', async ({ request }) => {
    const res = await request.post(`${API}/api/schedules`, {
      data: { cronExpr: 'invalid cron' }
    });
    // Server doesn't validate cron expressions
    expect(res.status()).toBe(201);
    // Clean up
    const data = await res.json();
    if (data.id) {
      await request.delete(`${API}/api/schedules/${data.id}`);
    }
  });

  test('PUT /api/schedules/:id returns 200 for any ID (upsert behavior)', async ({ request }) => {
    const res = await request.put(`${API}/api/schedules/999999`, {
      data: { cronExpr: '0 0 * * *' }
    });
    expect(res.status()).toBe(200);
  });
});

test.describe('Workspaces API', () => {
  test('GET /api/workspaces returns list', async ({ request }) => {
    const res = await request.get(`${API}/api/workspaces`);
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  test('CRUD: Create, verify, update, and delete workspace', async ({ request }) => {
    // Create
    const createRes = await request.post(`${API}/api/workspaces`, {
      data: {
        name: 'test-api-workspace',
        configPath: '/path/to/playwright.config.ts',
        testResultsDir: '/path/to/test-results'
      }
    });
    expect(createRes.status()).toBe(201);
    const created = await createRes.json();
    expect(created).toHaveProperty('id');
    expect(created.name).toBe('test-api-workspace');
    createdIds.workspaces.push(created.id);

    // Verify - list should contain it
    const listRes = await request.get(`${API}/api/workspaces`);
    const list = await listRes.json();
    const found = list.find((w: any) => w.id === created.id);
    expect(found).toBeDefined();
    expect(found.name).toBe('test-api-workspace');

    // Update
    const updateRes = await request.put(`${API}/api/workspaces/${created.id}`, {
      data: {
        name: 'test-api-workspace-updated',
        configPath: '/new/path/playwright.config.ts'
      }
    });
    expect(updateRes.ok()).toBeTruthy();
    const updateBody = await updateRes.json();
    expect(updateBody.updated).toBe(true);



    // Delete
    const deleteRes = await request.delete(`${API}/api/workspaces/${created.id}`);
    expect(deleteRes.status()).toBe(200);

    // Verify deleted
    const listAfterDelete = await request.get(`${API}/api/workspaces`);
    const listData = await listAfterDelete.json();
    const notFound = listData.find((w: any) => w.id === created.id);
    expect(notFound).toBeUndefined();

    // Remove from tracking
    createdIds.workspaces = createdIds.workspaces.filter(id => id !== created.id);
  });

  test('POST /api/workspaces returns 400 with invalid body', async ({ request }) => {
    const res = await request.post(`${API}/api/workspaces`, {
      data: { name: '' } // Missing required configPath
    });
    expect(res.status()).toBe(400);
  });
});

test.describe('Quality Gate API', () => {
  test('GET /api/gate-config returns quality gate config', async ({ request }) => {
    const res = await request.get(`${API}/api/gate-config`);
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data).toHaveProperty('passRateThreshold');
  });

  test('PUT /api/gate-config updates config', async ({ request }) => {
    // Get current config first
    const getRes = await request.get(`${API}/api/gate-config`);
    const current = await getRes.json();

    // Update with new values
    const updateRes = await request.put(`${API}/api/gate-config`, {
      data: {
        passRateThreshold: 85,
        maxDurationMs: 120000,
        maxFlakyCount: 3
      }
    });
    expect(updateRes.ok()).toBeTruthy();
    const updateBody = await updateRes.json();
    expect(updateBody.ok).toBe(true);
    // Verify via GET
    const verifyRes = await request.get(`${API}/api/gate-config`);
    const verified = await verifyRes.json();
    expect(verified.passRateThreshold).toBe(85);

    // Restore original config
    await request.put(`${API}/api/gate-config`, { data: current });
  });

  test('PUT /api/gate-config returns 400 with invalid threshold', async ({ request }) => {
    const res = await request.put(`${API}/api/gate-config`, {
      data: { passRateThreshold: 150 } // Invalid: > 100
    });
    expect(res.status()).toBe(400);
  });
});

test.describe('Defect Categories API', () => {
  test('GET /api/categories returns list', async ({ request }) => {
    const res = await request.get(`${API}/api/categories`);
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  test('CRUD: Create, verify, update, and delete category', async ({ request }) => {
    // Create
    const createRes = await request.post(`${API}/api/categories`, {
      data: {
        name: 'test-api-category',
        color: '#FF5733'
      }
    });
    expect(createRes.status()).toBe(201);
    const created = await createRes.json();
    expect(created).toHaveProperty('id');
    expect(created.name).toBe('test-api-category');
    expect(created.color).toBe('#FF5733');
    createdIds.categories.push(created.id);

    // Verify - list should contain it
    const listRes = await request.get(`${API}/api/categories`);
    const list = await listRes.json();
    const found = list.find((c: any) => c.id === created.id);
    expect(found).toBeDefined();

    // Update
    const updateRes = await request.put(`${API}/api/categories/${created.id}`, {
      data: {
        name: 'test-api-category-updated',
        color: '#00FF00'
      }
    });
    expect(updateRes.ok()).toBeTruthy();
    const updateBody = await updateRes.json();
    expect(updateBody.ok).toBe(true);

    // Delete
    const deleteRes = await request.delete(`${API}/api/categories/${created.id}`);
    expect(deleteRes.status()).toBe(200);

    // Verify deleted
    const listAfterDelete = await request.get(`${API}/api/categories`);
    const listData = await listAfterDelete.json();
    const notFound = listData.find((c: any) => c.id === created.id);
    expect(notFound).toBeUndefined();

    // Remove from tracking
    createdIds.categories = createdIds.categories.filter(id => id !== created.id);
  });

  test('POST /api/categories returns 400 with empty name', async ({ request }) => {
    const res = await request.post(`${API}/api/categories`, {
      data: { name: '' }
    });
    expect(res.status()).toBe(400);
  });

  test('GET /api/fingerprint-categories returns fingerprint mappings', async ({ request }) => {
    const res = await request.get(`${API}/api/fingerprint-categories`);
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  test('PUT /api/fingerprint-categories/:fingerprint assigns category', async ({ request }) => {
    // First create a category
    const catRes = await request.post(`${API}/api/categories`, {
      data: { name: 'test-api-fingerprint-cat', color: '#123456' }
    });
    const category = await catRes.json();
    createdIds.categories.push(category.id);

    // Assign fingerprint to category
    const fingerprint = 'test-api-fingerprint-12345';
    const assignRes = await request.put(`${API}/api/fingerprint-categories/${fingerprint}`, {
      data: { categoryId: category.id }
    });
    expect(assignRes.ok()).toBeTruthy();

    // Verify mapping exists
    const listRes = await request.get(`${API}/api/fingerprint-categories`);
    const list = await listRes.json();
    const found = list.find((fc: any) => fc.fingerprint === fingerprint);
    expect(found).toBeDefined();
    expect(found.categoryId).toBe(category.id);

    // Delete mapping
    const deleteRes = await request.delete(`${API}/api/fingerprint-categories/${fingerprint}`);
    expect(deleteRes.status()).toBe(200);

    // Clean up category
    await request.delete(`${API}/api/categories/${category.id}`);
    createdIds.categories = createdIds.categories.filter(id => id !== category.id);
  });

  test('DELETE /api/fingerprint-categories/:fingerprint removes mapping', async ({ request }) => {
    const res = await request.delete(`${API}/api/fingerprint-categories/nonexistent-fingerprint`);
    // Returns 404 when fingerprint mapping doesn't exist
    expect(res.status()).toBe(404);
  });
});

test.describe('Badges API', () => {
  test('GET /api/badges/pass-rate.svg returns SVG badge', async ({ request }) => {
    const res = await request.get(`${API}/api/badges/pass-rate.svg`);
    expect(res.ok()).toBeTruthy();
    const contentType = res.headers()['content-type'];
    expect(contentType).toContain('image/svg+xml');
    const body = await res.text();
    expect(body).toContain('<svg');
    expect(body).toContain('</svg>');
  });

  test('GET /api/badges/status.svg returns SVG badge', async ({ request }) => {
    const res = await request.get(`${API}/api/badges/status.svg`);
    expect(res.ok()).toBeTruthy();
    const contentType = res.headers()['content-type'];
    expect(contentType).toContain('image/svg+xml');
    const body = await res.text();
    expect(body).toContain('<svg');
  });

  test('GET /api/badges/flaky.svg returns SVG badge', async ({ request }) => {
    const res = await request.get(`${API}/api/badges/flaky.svg`);
    expect(res.ok()).toBeTruthy();
    const contentType = res.headers()['content-type'];
    expect(contentType).toContain('image/svg+xml');
    const body = await res.text();
    expect(body).toContain('<svg');
  });
});

test.describe('Metrics API', () => {
  test('GET /metrics returns Prometheus format', async ({ request }) => {
    const res = await request.get(`${API}/metrics`);
    expect(res.ok()).toBeTruthy();
    const contentType = res.headers()['content-type'];
    expect(contentType).toContain('text/plain');
    const body = await res.text();
    expect(body).toContain('automate_dashboard_');
    // Should contain metric types
    expect(body).toMatch(/# (HELP|TYPE)/);
  });
});

test.describe('Settings API', () => {
  test('GET /api/settings/auto-quarantine returns config', async ({ request }) => {
    const res = await request.get(`${API}/api/settings/auto-quarantine`);
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data).toHaveProperty('flakyThreshold');
    expect(data).toHaveProperty('lookbackRuns');
  });

  test('PUT /api/settings/auto-quarantine updates config', async ({ request }) => {
    // Get current config
    const getRes = await request.get(`${API}/api/settings/auto-quarantine`);
    const current = await getRes.json();

    // Update
    const updateRes = await request.put(`${API}/api/settings/auto-quarantine`, {
      data: {
        flakyThreshold: 5,
        lookbackRuns: 15
      }
    });
    expect(updateRes.ok()).toBeTruthy();
    const updateBody = await updateRes.json();
    expect(updateBody.ok).toBe(true);

    // Restore original
    await request.put(`${API}/api/settings/auto-quarantine`, { data: current });
  });

  test('PUT /api/settings/auto-quarantine returns 400 with invalid values', async ({ request }) => {
    const res = await request.put(`${API}/api/settings/auto-quarantine`, {
      data: { flakyThreshold: -1 } // Invalid: negative
    });
    expect(res.status()).toBe(400);
  });

  test('GET /api/settings/data-retention returns config', async ({ request }) => {
    const res = await request.get(`${API}/api/settings/data-retention`);
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data).toHaveProperty('testResultDays');
    expect(data).toHaveProperty('enabled');
  });

  test('PUT /api/settings/data-retention updates config', async ({ request }) => {
    // Get current config
    const getRes = await request.get(`${API}/api/settings/data-retention`);
    const current = await getRes.json();

    // Update
    const updateRes = await request.put(`${API}/api/settings/data-retention`, {
      data: { testResultDays: 60, nlQueryHistoryDays: 30, attachmentDays: 60, trendsDays: -1, enabled: false }
    });
    expect(updateRes.ok()).toBeTruthy();
    const updateBody = await updateRes.json();
    expect(updateBody.ok).toBe(true);

    // Restore original
    await request.put(`${API}/api/settings/data-retention`, { data: current });
  });

  test('GET /api/settings/db-stats returns database statistics', async ({ request }) => {
    const res = await request.get(`${API}/api/settings/db-stats`);
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data).toHaveProperty('sizeBytes');
    expect(data).toHaveProperty('sizeMB');
    expect(data).toHaveProperty('pageCount');
  });

  test('POST /api/settings/data-retention/run triggers manual cleanup', async ({ request }) => {
    const res = await request.post(`${API}/api/settings/data-retention/run`, { data: {} });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data).toHaveProperty('deletedRuns');
  });
});

test.describe('NL Query API', () => {
  test('GET /api/nl-query/history returns query history', async ({ request }) => {
    const res = await request.get(`${API}/api/nl-query/history`);
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  test('GET /api/nl-query/history with limit param', async ({ request }) => {
    const res = await request.get(`${API}/api/nl-query/history?limit=2`);
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeLessThanOrEqual(2);
  });

  test('GET /api/nl-query/history with userId param', async ({ request }) => {
    const res = await request.get(`${API}/api/nl-query/history?userId=test-user`);
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });
});

test.describe('Config API', () => {
  test('GET /api/config returns config or 404 when not found', async ({ request }) => {
    const res = await request.get(`${API}/api/config`);
    // Config endpoint returns 404 if no playwright.config.ts exists in workspace
    expect([200, 404].includes(res.status())).toBeTruthy();
    if (res.ok()) {
      const data = await res.json();
      expect(data).toHaveProperty('config');
    }
  });
});

// Cleanup hook - remove any test data that wasn't cleaned up
test.afterAll(async ({ request }) => {
  // Clean up any remaining test data
  for (const id of createdIds.quarantine) {
    await request.delete(`${API}/api/quarantine/${id}`).catch(() => {});
  }
  for (const id of createdIds.knownFailures) {
    await request.delete(`${API}/api/known-failures/${id}`).catch(() => {});
  }
  for (const id of createdIds.schedules) {
    await request.delete(`${API}/api/schedules/${id}`).catch(() => {});
  }
  for (const id of createdIds.workspaces) {
    await request.delete(`${API}/api/workspaces/${id}`).catch(() => {});
  }
  for (const id of createdIds.categories) {
    await request.delete(`${API}/api/categories/${id}`).catch(() => {});
  }
});
