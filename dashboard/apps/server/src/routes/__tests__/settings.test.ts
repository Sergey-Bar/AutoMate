import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestApp, type TestApp } from '../../test/create-test-app.js';
import * as fixtures from '../../test/fixtures.js';

let testApp: TestApp;

const fsMock = {
  existsSync: vi.fn<(path: string) => boolean>(),
  readFileSync: vi.fn<(path: string, encoding: string) => string>(),
  mkdirSync: vi.fn<(path: string, options: { recursive: boolean }) => void>(),
  writeFileSync: vi.fn<(path: string, data: string, encoding: string) => void>(),
};

const retentionServiceMock = {
  loadRetentionConfig: vi.fn(),
  saveRetentionConfig: vi.fn(),
  runRetentionCleanup: vi.fn(),
  getDbStats: vi.fn(),
};

vi.mock('node:fs', () => ({
  default: fsMock,
}));

const sqliteBackupMock = vi.fn().mockResolvedValue(undefined);
const sqliteCloseMock = vi.fn();
vi.mock('../../db/client.js', () => ({
  poolConnection: { backup: sqliteBackupMock, close: sqliteCloseMock },
}));


vi.mock('../..//services/data-retention.js', () => retentionServiceMock);

describe('settings routes', () => {
  beforeAll(async () => {
    testApp = await createTestApp();
    const { registerSettingsRoutes } = await import('../settings.js');
    await registerSettingsRoutes(testApp.app);
    await testApp.app.ready();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    fsMock.existsSync.mockReturnValue(false);
    retentionServiceMock.loadRetentionConfig.mockReturnValue({
      testResultDays: 90,
      nlQueryHistoryDays: 30,
      attachmentDays: 60,
      trendsDays: -1,
      enabled: false,
    });
    retentionServiceMock.runRetentionCleanup.mockResolvedValue({
      deletedRuns: 1,
      deletedResults: 2,
      deletedNlQueries: 3,
      deletedAttachments: 4,
      durationMs: 55,
    });
    retentionServiceMock.getDbStats.mockReturnValue({
      sizeBytes: 4096,
      sizeMB: '0.00',
      pageCount: 1,
      pageSize: 4096,
    });

    testApp.poolConnection.exec('DELETE FROM runs');
  });

  afterAll(async () => {
    await testApp.app.close();
    testApp.poolConnection.close();
  });

  it('GET /api/settings/auto-quarantine returns defaults when config file is missing', async () => {
    const res = await testApp.app.inject({ method: 'GET', url: '/api/settings/auto-quarantine' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ flakyThreshold: 3, lookbackRuns: 10 });
  });

  it('GET /api/settings/auto-quarantine returns defaults when config file exists but readFileSync throws', async () => {
    fsMock.existsSync.mockReturnValue(true);
    fsMock.readFileSync.mockImplementation(() => {
      throw new Error('Permission denied');
    });

    const res = await testApp.app.inject({ method: 'GET', url: '/api/settings/auto-quarantine' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ flakyThreshold: 3, lookbackRuns: 10 });
  });

  it('PUT /api/settings/auto-quarantine rejects invalid body', async () => {
    const res = await testApp.app.inject({
      method: 'PUT',
      url: '/api/settings/auto-quarantine',
      payload: { flakyThreshold: 0, lookbackRuns: 0 },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      error: {
        formErrors: [],
        fieldErrors: {
          flakyThreshold: ['Number must be greater than or equal to 1'],
          lookbackRuns: ['Number must be greater than or equal to 1'],
        },
      },
    });
  });

  it('PUT /api/settings/auto-quarantine saves valid config', async () => {
    fsMock.existsSync.mockImplementation((candidatePath: string) => candidatePath.includes('auto-quarantine.json'));

    const res = await testApp.app.inject({
      method: 'PUT',
      url: '/api/settings/auto-quarantine',
      payload: { flakyThreshold: 4, lookbackRuns: 20 },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(fsMock.writeFileSync).toHaveBeenCalledTimes(1);
    expect(fsMock.writeFileSync.mock.calls[0][0]).toContain('.automate');
    expect(fsMock.writeFileSync.mock.calls[0][0]).toContain('auto-quarantine.json');
    expect(fsMock.writeFileSync.mock.calls[0][1]).toContain('"flakyThreshold": 4');
    expect(fsMock.writeFileSync.mock.calls[0][1]).toContain('"lookbackRuns": 20');
    expect(fsMock.writeFileSync.mock.calls[0][2]).toBe('utf-8');
  });

  it('GET /api/settings/data-retention returns config from service', async () => {
    const config = {
      testResultDays: 12,
      nlQueryHistoryDays: 13,
      attachmentDays: 14,
      trendsDays: -1,
      enabled: true,
    };
    retentionServiceMock.loadRetentionConfig.mockReturnValue(config);

    const res = await testApp.app.inject({ method: 'GET', url: '/api/settings/data-retention' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(config);
    expect(retentionServiceMock.loadRetentionConfig).toHaveBeenCalledTimes(1);
  });

  it('PUT /api/settings/data-retention rejects invalid body', async () => {
    const res = await testApp.app.inject({
      method: 'PUT',
      url: '/api/settings/data-retention',
      payload: {
        testResultDays: 0,
        nlQueryHistoryDays: 30,
        attachmentDays: 60,
        trendsDays: -1,
        enabled: true,
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      error: {
        formErrors: [],
        fieldErrors: {
          testResultDays: ['Number must be greater than or equal to 1'],
        },
      },
    });
  });

  it('PUT /api/settings/data-retention validates and saves config', async () => {
    const payload = {
      testResultDays: 45,
      nlQueryHistoryDays: 15,
      attachmentDays: 22,
      trendsDays: 365,
      enabled: true,
    };

    const res = await testApp.app.inject({
      method: 'PUT',
      url: '/api/settings/data-retention',
      payload,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(retentionServiceMock.saveRetentionConfig).toHaveBeenCalledTimes(1);
    expect(retentionServiceMock.saveRetentionConfig).toHaveBeenCalledWith(payload);
  });

  it('POST /api/settings/data-retention/run triggers cleanup and returns result', async () => {
    const seededRun = fixtures.run({ total: 25, passed: 24, failed: 1, status: 'passed' });
    testApp.sqlite
      .prepare(
        'INSERT INTO runs (id, started_at, finished_at, status, total, passed, failed, flaky, skipped, duration_ms, branch, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        seededRun.id,
        seededRun.startedAt,
        seededRun.finishedAt,
        seededRun.status,
        seededRun.total,
        seededRun.passed,
        seededRun.failed,
        seededRun.flaky,
        seededRun.skipped,
        seededRun.durationMs,
        seededRun.branch,
        seededRun.source,
      );

    const res = await testApp.app.inject({ method: 'POST', url: '/api/settings/data-retention/run' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      deletedRuns: 1,
      deletedResults: 2,
      deletedNlQueries: 3,
      deletedAttachments: 4,
      durationMs: 55,
    });
    expect(retentionServiceMock.loadRetentionConfig).toHaveBeenCalledTimes(1);
    expect(retentionServiceMock.runRetentionCleanup).toHaveBeenCalledTimes(1);
  });

  it('GET /api/settings/db-stats returns stats object', async () => {
    const res = await testApp.app.inject({ method: 'GET', url: '/api/settings/db-stats' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      sizeBytes: 4096,
      sizeMB: '0.00',
      pageCount: 1,
      pageSize: 4096,
    });
    expect(retentionServiceMock.getDbStats).toHaveBeenCalledTimes(1);
  });
});
