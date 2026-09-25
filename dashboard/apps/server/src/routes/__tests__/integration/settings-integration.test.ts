import { Readable } from 'node:stream';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestApp, type TestApp } from '../../../test/create-test-app.js';

let testApp: TestApp;

const {
  fsMock,
  retentionServiceMock,
  sqliteBackupMock,
  sqliteCloseMock,
} = vi.hoisted(() => ({
  fsMock: {
    existsSync: vi.fn<(targetPath: string) => boolean>(),
    readFileSync: vi.fn<(targetPath: string, encoding: string) => string>(),
    mkdirSync: vi.fn<(targetPath: string, options: { recursive: boolean }) => void>(),
    writeFileSync: vi.fn<(targetPath: string, data: string, encoding: string) => void>(),
    createReadStream: vi.fn<(targetPath: string) => NodeJS.ReadableStream>(),
    unlinkSync: vi.fn<(targetPath: string) => void>(),
    copyFileSync: vi.fn<(src: string, dest: string) => void>(),
  },
  retentionServiceMock: {
    loadRetentionConfig: vi.fn(),
    saveRetentionConfig: vi.fn(),
    runRetentionCleanup: vi.fn(),
    getDbStats: vi.fn(),
  },
  sqliteBackupMock: vi.fn<(targetPath: string) => Promise<void>>(),
  sqliteCloseMock: vi.fn<() => void>(),
}));

vi.mock('node:fs', () => ({
  default: fsMock,
}));

vi.mock('../../../services/data-retention.js', () => retentionServiceMock);

vi.mock('../../../db/client.js', () => ({
  sqlite: {
    backup: sqliteBackupMock,
    close: sqliteCloseMock,
  },
}));

describe('settings integration routes', () => {
  beforeAll(async () => {
    testApp = await createTestApp();
    const { registerSettingsRoutes } = await import('../../settings.js');
    await registerSettingsRoutes(testApp.app);
    await testApp.app.ready();
  });

  beforeEach(() => {
    vi.clearAllMocks();

    fsMock.existsSync.mockReturnValue(false);
    fsMock.createReadStream.mockImplementation(() => Readable.from(Buffer.from('sqlite-backup-bytes')));

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
      durationMs: 42,
    });
    retentionServiceMock.getDbStats.mockReturnValue({
      sizeBytes: 4096,
      sizeMB: '0.00',
      pageCount: 1,
      pageSize: 4096,
    });
    sqliteBackupMock.mockResolvedValue(undefined);
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

  it('PUT /api/settings/auto-quarantine validates payload', async () => {
    const res = await testApp.app.inject({
      method: 'PUT',
      url: '/api/settings/auto-quarantine',
      payload: { flakyThreshold: 0, lookbackRuns: 0 },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.fieldErrors.flakyThreshold[0]).toContain('greater than or equal to 1');
    expect(res.json().error.fieldErrors.lookbackRuns[0]).toContain('greater than or equal to 1');
  });

  it('PUT /api/settings/auto-quarantine saves valid config file', async () => {
    const res = await testApp.app.inject({
      method: 'PUT',
      url: '/api/settings/auto-quarantine',
      payload: { flakyThreshold: 5, lookbackRuns: 15 },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(fsMock.writeFileSync).toHaveBeenCalledTimes(1);
    expect(fsMock.writeFileSync.mock.calls[0]?.[1]).toContain('"flakyThreshold": 5');
    expect(fsMock.writeFileSync.mock.calls[0]?.[1]).toContain('"lookbackRuns": 15');
  });

  it('GET /api/settings/data-retention returns retention config from service', async () => {
    retentionServiceMock.loadRetentionConfig.mockReturnValue({
      testResultDays: 14,
      nlQueryHistoryDays: 21,
      attachmentDays: 35,
      trendsDays: -1,
      enabled: true,
    });

    const res = await testApp.app.inject({ method: 'GET', url: '/api/settings/data-retention' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      testResultDays: 14,
      nlQueryHistoryDays: 21,
      attachmentDays: 35,
      trendsDays: -1,
      enabled: true,
    });
  });

  it('POST /api/settings/data-retention/run returns cleanup result', async () => {
    const res = await testApp.app.inject({ method: 'POST', url: '/api/settings/data-retention/run' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      deletedRuns: 1,
      deletedResults: 2,
      deletedNlQueries: 3,
      deletedAttachments: 4,
      durationMs: 42,
    });
    expect(retentionServiceMock.runRetentionCleanup).toHaveBeenCalledTimes(1);
  });

  it('GET /api/settings/db-stats returns DB stats from service', async () => {
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

  it('GET /api/settings/backup streams sqlite backup', async () => {
    const res = await testApp.app.inject({ method: 'GET', url: '/api/settings/backup' });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/octet-stream');
    expect(res.headers['content-disposition']).toContain('automate-backup-');
    expect(sqliteBackupMock).toHaveBeenCalledTimes(1);
    expect(sqliteBackupMock.mock.calls[0]?.[0]).toContain('.backup-temp.db');
  });

  it('GET /api/settings/backup returns 500 when backup fails', async () => {
    sqliteBackupMock.mockRejectedValueOnce(new Error('backup failed'));

    const res = await testApp.app.inject({ method: 'GET', url: '/api/settings/backup' });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: 'Failed to create database backup' });
  });
});
