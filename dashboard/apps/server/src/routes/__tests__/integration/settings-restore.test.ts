/**
 * Additional settings routes tests for previously uncovered paths:
 * - Backup stream close/error event handlers
 * - POST /api/settings/restore endpoint (all branches)
 */
import { Readable } from 'node:stream';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import multipart from '@fastify/multipart';
import { createTestApp, type TestApp } from '../../../test/create-test-app.js';

let testApp: TestApp;

const {
  fsMock,
  retentionServiceMock,
  sqliteBackupMock,
  sqliteCloseMock,
  mockDbPrepare,
  mockDatabaseConstructor,
} = vi.hoisted(() => {
  const mockDbPrepare = vi.fn();
  const _mockDbClose = vi.fn();
  const mockDatabaseConstructor = vi.fn((_filePath: string, _options?: { readonly?: boolean }) => ({
    prepare: mockDbPrepare,
    close: _mockDbClose,
  }));

  return {
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
    mockDbPrepare,
    mockDatabaseConstructor,
  };
});

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

// Mock better-sqlite3 so:
// - The test helper's in-memory DB construction still uses the real module
// - The route's validation DB (opened with readonly:true) uses the mock
vi.mock('better-sqlite3', async (importOriginal) => {
  const actual = await importOriginal<typeof import('better-sqlite3')>();
  return {
    default: function mockedDatabase(filePath: string, options?: { readonly?: boolean }) {
      if (options?.readonly) {
        // Route-level validation call — use mock
        return mockDatabaseConstructor(filePath, options);
      }
      // createTestApp call — use real Database
      return new actual.default(filePath, options);
    },
  };
});

describe('settings routes - backup stream events and restore', () => {
  beforeAll(async () => {
    testApp = await createTestApp();
    await testApp.app.register(multipart, { limits: { fileSize: 500 * 1024 * 1024 } });
    const { registerSettingsRoutes } = await import('../../settings.js');
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
      deletedRuns: 0,
      deletedResults: 0,
      deletedNlQueries: 0,
      deletedAttachments: 0,
      durationMs: 0,
    });
    retentionServiceMock.getDbStats.mockReturnValue({
      sizeBytes: 4096,
      sizeMB: '0.00',
      pageCount: 1,
      pageSize: 4096,
    });
    sqliteBackupMock.mockResolvedValue(undefined);

    // Default: DB integrity check returns 'ok'
    mockDbPrepare.mockReturnValue({
      pluck: () => ({ get: () => 'ok' }),
    });
  });

  afterAll(async () => {
    await testApp.app.close();
    testApp.poolConnection.close();
  });

  describe('GET /api/settings/backup stream lifecycle', () => {
    it('cleans up backup temp file on stream close event', async () => {
      let closeHandler: (() => void) | undefined;
      const mockStream = new Readable({
        read() {
          this.push(Buffer.from('sqlite-data'));
          this.push(null);
        },
      });
      const originalOn = mockStream.on.bind(mockStream);
      vi.spyOn(mockStream, 'on').mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
        if (event === 'close') {
          closeHandler = handler as () => void;
        }
        return originalOn(event, handler);
      });
      fsMock.createReadStream.mockReturnValue(mockStream);
      fsMock.existsSync.mockImplementation((p: string) => p.includes('.backup-temp.db'));

      const res = await testApp.app.inject({ method: 'GET', url: '/api/settings/backup' });
      expect(res.statusCode).toBe(200);

      closeHandler?.();
      expect(fsMock.unlinkSync).toHaveBeenCalledWith(expect.stringContaining('.backup-temp.db'));
    });

    it('cleans up backup temp file on stream error event', async () => {
      let errorHandler: ((err: Error) => void) | undefined;
      const mockStream = new Readable({
        read() {
          this.push(Buffer.from('sqlite-data'));
          this.push(null);
        },
      });
      const originalOn = mockStream.on.bind(mockStream);
      vi.spyOn(mockStream, 'on').mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
        if (event === 'error') {
          errorHandler = handler as (err: Error) => void;
        }
        return originalOn(event, handler);
      });
      fsMock.createReadStream.mockReturnValue(mockStream);
      fsMock.existsSync.mockImplementation((p: string) => p.includes('.backup-temp.db'));

      const res = await testApp.app.inject({ method: 'GET', url: '/api/settings/backup' });
      expect(res.statusCode).toBe(200);

      errorHandler?.(new Error('stream error'));
      expect(fsMock.unlinkSync).toHaveBeenCalledWith(expect.stringContaining('.backup-temp.db'));
    });

    it('does not call unlinkSync on stream close if backup file does not exist', async () => {
      let closeHandler: (() => void) | undefined;
      const mockStream = new Readable({
        read() {
          this.push(Buffer.from('data'));
          this.push(null);
        },
      });
      const originalOn = mockStream.on.bind(mockStream);
      vi.spyOn(mockStream, 'on').mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
        if (event === 'close') closeHandler = handler as () => void;
        return originalOn(event, handler);
      });
      fsMock.createReadStream.mockReturnValue(mockStream);
      fsMock.existsSync.mockReturnValue(false);

      await testApp.app.inject({ method: 'GET', url: '/api/settings/backup' });
      closeHandler?.();

      expect(fsMock.unlinkSync).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/settings/restore', () => {
    it('returns 400 when no file field is in the multipart request', async () => {
      // Send a multipart form with a text field (not a file) so req.file() returns null
      const boundary = '----FormBoundaryNoFile';
      const body = [
        `--${boundary}`,
        'Content-Disposition: form-data; name="someField"',
        '',
        'someValue',
        `--${boundary}--`,
      ].join('\r\n');

      const res = await testApp.app.inject({
        method: 'POST',
        url: '/api/settings/restore',
        payload: body,
        headers: {
          'content-type': `multipart/form-data; boundary=${boundary}`,
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: expect.stringContaining('No database file uploaded') });
    });

    it('returns 400 when uploaded file is not a .db file', async () => {
      const boundary = '----FormBoundary123';
      const body = [
        `--${boundary}`,
        'Content-Disposition: form-data; name="file"; filename="backup.txt"',
        'Content-Type: text/plain',
        '',
        'some content',
        `--${boundary}--`,
      ].join('\r\n');

      const res = await testApp.app.inject({
        method: 'POST',
        url: '/api/settings/restore',
        payload: body,
        headers: {
          'content-type': `multipart/form-data; boundary=${boundary}`,
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: expect.stringContaining('.db') });
    });

    it('returns 400 when uploaded .db file fails integrity check', async () => {
      // Integrity check returns non-ok value
      mockDbPrepare.mockReturnValue({
        pluck: () => ({ get: () => 'malformed' }),
      });

      const boundary = '----FormBoundary456';
      const dbContent = Buffer.from('not-a-real-sqlite-db');
      const body = Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="corrupt.db"\r\nContent-Type: application/octet-stream\r\n\r\n`),
        dbContent,
        Buffer.from(`\r\n--${boundary}--`),
      ]);

      const res = await testApp.app.inject({
        method: 'POST',
        url: '/api/settings/restore',
        payload: body,
        headers: {
          'content-type': `multipart/form-data; boundary=${boundary}`,
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: expect.stringContaining('valid SQLite') });
    });

    it('returns 400 when Database constructor throws (invalid SQLite file)', async () => {
      mockDatabaseConstructor.mockImplementationOnce(() => {
        throw new Error('not a SQLite database');
      });

      const boundary = '----FormBoundary789';
      const dbContent = Buffer.from('garbage-bytes');
      const body = Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="bad.db"\r\nContent-Type: application/octet-stream\r\n\r\n`),
        dbContent,
        Buffer.from(`\r\n--${boundary}--`),
      ]);

      const res = await testApp.app.inject({
        method: 'POST',
        url: '/api/settings/restore',
        payload: body,
        headers: {
          'content-type': `multipart/form-data; boundary=${boundary}`,
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: expect.stringContaining('valid SQLite') });
    });

    it('returns 200 with restart message when valid .db file is uploaded', async () => {
      // mockDbPrepare defaults to returning 'ok' from beforeEach
      const boundary = '----FormBoundaryOK';
      const dbContent = Buffer.from('SQLite format 3\x00valid-db-bytes');
      const body = Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="good.db"\r\nContent-Type: application/octet-stream\r\n\r\n`),
        dbContent,
        Buffer.from(`\r\n--${boundary}--`),
      ]);

      const res = await testApp.app.inject({
        method: 'POST',
        url: '/api/settings/restore',
        payload: body,
        headers: {
          'content-type': `multipart/form-data; boundary=${boundary}`,
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        ok: true,
        message: expect.stringContaining('restart'),
      });
    });

    it('cleans up temp file after successful restore', async () => {
      fsMock.existsSync.mockImplementation((p: string) => p.includes('.restore-upload-'));

      const boundary = '----FormBoundaryClean';
      const dbContent = Buffer.from('SQLite format 3\x00');
      const body = Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="backup.db"\r\nContent-Type: application/octet-stream\r\n\r\n`),
        dbContent,
        Buffer.from(`\r\n--${boundary}--`),
      ]);

      await testApp.app.inject({
        method: 'POST',
        url: '/api/settings/restore',
        payload: body,
        headers: {
          'content-type': `multipart/form-data; boundary=${boundary}`,
        },
      });

      expect(fsMock.unlinkSync).toHaveBeenCalledWith(expect.stringContaining('.restore-upload-'));
    });

    it('returns 500 and cleans up temp file when backup fails during restore', async () => {
      fsMock.existsSync.mockImplementation((p: string) => p.includes('.restore-upload-'));
      sqliteBackupMock.mockRejectedValueOnce(new Error('backup during restore failed'));

      const boundary = '----FormBoundaryErr';
      const dbContent = Buffer.from('SQLite format 3\x00');
      const body = Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="backup.db"\r\nContent-Type: application/octet-stream\r\n\r\n`),
        dbContent,
        Buffer.from(`\r\n--${boundary}--`),
      ]);

      const res = await testApp.app.inject({
        method: 'POST',
        url: '/api/settings/restore',
        payload: body,
        headers: {
          'content-type': `multipart/form-data; boundary=${boundary}`,
        },
      });

      expect(res.statusCode).toBe(500);
      expect(res.json()).toMatchObject({ error: expect.stringContaining('restore') });
      expect(fsMock.unlinkSync).toHaveBeenCalledWith(expect.stringContaining('.restore-upload-'));
    });
  });
});

describe('getAutoQuarantineConfig (line 198 export)', () => {
  it('returns the loaded auto-quarantine config from filesystem', async () => {
    fsMock.existsSync.mockReturnValue(true);
    fsMock.readFileSync.mockReturnValue(JSON.stringify({ flakyThreshold: 5, lookbackRuns: 20 }));

    const { getAutoQuarantineConfig } = await import('../../settings.js');
    const config = getAutoQuarantineConfig();

    expect(config).toMatchObject({ flakyThreshold: 5, lookbackRuns: 20 });
  });

  it('returns the default config when the config file does not exist', async () => {
    fsMock.existsSync.mockReturnValue(false);

    const { getAutoQuarantineConfig } = await import('../../settings.js');
    const config = getAutoQuarantineConfig();

    expect(config).toMatchObject({ flakyThreshold: 3, lookbackRuns: 10 });
  });
});
