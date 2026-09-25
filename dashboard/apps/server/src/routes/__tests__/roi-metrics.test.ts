import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { vi } from 'vitest';
import { createTestApp, type TestApp } from '../../test/create-test-app.js';

let testApp: TestApp;

vi.mock('../../db/client.js', () => ({
  get db() { return testApp.db; },
  get poolConnection() { return testApp.poolConnection; },
}));

describe('GET /api/analytics/roi-metrics', () => {
  beforeAll(async () => {
    testApp = await createTestApp();
    const { analyticsRoutes } = await import('../analytics.js');
    await analyticsRoutes(testApp.app);
    await testApp.app.ready();
  });

  afterAll(async () => {
    await testApp.app.close();
    testApp.poolConnection.close();
  });

  beforeEach(() => {
    testApp.poolConnection.exec(
      'DELETE FROM trends; DELETE FROM runs; DELETE FROM quarantine;',
    );
  });

  it('returns 200 with all metric keys (empty database)', async () => {
    const res = await testApp.app.inject({
      method: 'GET',
      url: '/api/analytics/roi-metrics',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty('qualityTrend');
    expect(body).toHaveProperty('flakyTestCost');
    expect(body).toHaveProperty('quarantineEffectiveness');
    expect(body).toHaveProperty('escapedDefectRate');
    expect(body).toHaveProperty('mttd');
    expect(body).toHaveProperty('releaseFrequency');
  });

  it('accepts period=30d', async () => {
    const res = await testApp.app.inject({
      method: 'GET',
      url: '/api/analytics/roi-metrics?period=30d',
    });
    expect(res.statusCode).toBe(200);
  });

  it('accepts period=60d', async () => {
    const res = await testApp.app.inject({
      method: 'GET',
      url: '/api/analytics/roi-metrics?period=60d',
    });
    expect(res.statusCode).toBe(200);
  });

  it('accepts period=90d', async () => {
    const res = await testApp.app.inject({
      method: 'GET',
      url: '/api/analytics/roi-metrics?period=90d',
    });
    expect(res.statusCode).toBe(200);
  });

  it('falls back to 30d for invalid period', async () => {
    const res = await testApp.app.inject({
      method: 'GET',
      url: '/api/analytics/roi-metrics?period=999d',
    });
    expect(res.statusCode).toBe(200);
  });

  it('returns correct structure when trends data exists', async () => {
    const today = new Date().toISOString().slice(0, 10);
    testApp.poolConnection.exec(`
      INSERT INTO trends (date, project, branch, total, passed, failed, flaky, avg_duration_ms)
      VALUES ('${today}', 'default', 'main', 100, 90, 10, 5, 3000)
    `);
    const res = await testApp.app.inject({
      method: 'GET',
      url: '/api/analytics/roi-metrics?period=30d',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.qualityTrend.currentPassRate).toBe(90);
    expect(body.qualityTrend.dataPoints).toHaveLength(1);
    expect(body.flakyTestCost.flakyReruns).toBe(5);
    expect(body.releaseFrequency.runsPerWeek).toBe(0); // no runs table entries
  });

  it('computes frequency and escape-rate correctly with run data', async () => {
    // Insert runs in both the current period and the previous period
    const recentDate = new Date();
    recentDate.setDate(recentDate.getDate() - 5); // 5 days ago (within 30d)
    const prevDate = new Date();
    prevDate.setDate(prevDate.getDate() - 40); // 40 days ago (within 30d-60d window)

    testApp.poolConnection.exec(`
      INSERT INTO runs (id, started_at, finished_at, status, total, passed, failed, flaky, skipped,
                        duration_ms, branch, triggered_by, source)
      VALUES ('run-curr-1', '${recentDate.toISOString()}', '${recentDate.toISOString()}',
              'passed', 100, 95, 5, 0, 0, 180000, 'main', 'ci', 'live'),
             ('run-prev-1', '${prevDate.toISOString()}', '${prevDate.toISOString()}',
              'passed', 80, 70, 10, 0, 0, 120000, 'main', 'ci', 'live')
    `);
    const res = await testApp.app.inject({
      method: 'GET',
      url: '/api/analytics/roi-metrics?period=30d',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // 1 run in 30d = ~0.2/week
    expect(body.releaseFrequency.totalRuns).toBe(1);
    expect(body.releaseFrequency.runsPerWeek).toBeGreaterThan(0);
    // prev period had 1 run — prevEscapedRate branch covered
    expect(body.escapedDefectRate).toHaveProperty('changeVsPrevious');
  });
});
