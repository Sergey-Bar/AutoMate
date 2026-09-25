/**
 * Branch coverage for ingest routes.
 * Targets: missing file (no data), invalid content type, validation error,
 * empty upload, oversized upload, bad magic bytes, exec error, merge bad runId
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestApp, type TestApp } from '../../test/create-test-app.js';

const {
  mockMkdir,
  mockWriteFile,
  mockExecFile,
  mockReqFile,
} = vi.hoisted(() => ({
  mockMkdir: vi.fn<(targetPath: string, options: { recursive: boolean }) => Promise<void>>(),
  mockWriteFile: vi.fn<(targetPath: string, buffer: Buffer) => Promise<void>>(),
  mockExecFile: vi.fn(),
  mockReqFile: vi.fn(),
}));

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

vi.mock('fs/promises', () => ({
  mkdir: mockMkdir,
  writeFile: mockWriteFile,
}));

vi.mock('child_process', () => ({
  execFile: mockExecFile,
}));

describe('ingest routes — branch coverage', () => {
  beforeAll(async () => {
    process.env.BLOBS_DIR = '/blob-root';
    testApp = await createTestApp();
    testApp.app.decorateRequest('file', () => mockReqFile());
    const { ingestRoutes } = await import('../ingest.js');
    await ingestRoutes(testApp.app);
    await testApp.app.ready();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    testApp.poolConnection.exec('DELETE FROM results; DELETE FROM tests; DELETE FROM runs; DELETE FROM blob_shards;');
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
    mockReqFile.mockReset();
    mockExecFile.mockReset();
  });

  afterAll(async () => {
    await testApp.app.close();
    testApp.poolConnection.close();
  });

  it('POST /api/ingest/blob returns 400 when no file is uploaded', async () => {
    mockReqFile.mockResolvedValue(null);

    const res = await testApp.app.inject({ method: 'POST', url: '/api/ingest/blob' });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'No file uploaded' });
  });

  it('POST /api/ingest/blob returns 400 when runId is invalid UUID', async () => {
    mockReqFile.mockResolvedValue({
      mimetype: 'application/zip',
      fields: {
        runId: { value: 'not-a-uuid' },
        shardIndex: { value: '1' },
        totalShards: { value: '1' },
      },
      toBuffer: vi.fn().mockResolvedValue(Buffer.from([0x50, 0x4b, 0x03, 0x04])),
    });

    const res = await testApp.app.inject({ method: 'POST', url: '/api/ingest/blob' });

    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: { formErrors: string[] } };
    expect(body.error).toBeDefined();
  });

  it('POST /api/ingest/blob returns 413 when buffer exceeds max size', async () => {
    // Create a buffer that is larger than 500MB by mocking
    const fakeBuffer = {
      length: 600 * 1024 * 1024, // 600MB
      subarray: vi.fn().mockReturnValue({ equals: vi.fn().mockReturnValue(true) }),
    };
    mockReqFile.mockResolvedValue({
      mimetype: 'application/zip',
      fields: {
        runId: { value: '77777777-7777-4777-8777-777777777777' },
        shardIndex: { value: '1' },
        totalShards: { value: '1' },
      },
      toBuffer: vi.fn().mockResolvedValue(fakeBuffer),
    });

    const res = await testApp.app.inject({ method: 'POST', url: '/api/ingest/blob' });

    expect(res.statusCode).toBe(413);
    const body = res.json() as { error: string; maxSize: string };
    expect(body.error).toBe('File too large');
    expect(body.maxSize).toContain('MB');
  });

  it('POST /api/ingest/blob returns 400 when file is not a valid ZIP (bad magic bytes)', async () => {
    const notAZip = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04]);
    mockReqFile.mockResolvedValue({
      mimetype: 'application/zip',
      fields: {
        runId: { value: '88888888-8888-4888-8888-888888888888' },
        shardIndex: { value: '1' },
        totalShards: { value: '1' },
      },
      toBuffer: vi.fn().mockResolvedValue(notAZip),
    });

    const res = await testApp.app.inject({ method: 'POST', url: '/api/ingest/blob' });

    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: string };
    expect(body.error).toContain('not a valid ZIP archive');
  });

  it('POST /api/ingest/blob returns 500 when writeFile throws', async () => {
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockRejectedValue(new Error('Disk full'));
    mockReqFile.mockResolvedValue({
      mimetype: 'application/zip',
      fields: {
        runId: { value: '99999999-9999-4999-8999-999999999999' },
        shardIndex: { value: '1' },
        totalShards: { value: '1' },
      },
      toBuffer: vi.fn().mockResolvedValue(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00])),
    });

    const res = await testApp.app.inject({ method: 'POST', url: '/api/ingest/blob' });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: 'Failed to save blob shard' });
  });

  it('POST /api/ingest/blob/merge returns 400 when runId is invalid', async () => {
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/ingest/blob/merge',
      payload: { runId: 'not-a-uuid' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'runId must be a valid UUID' });
  });

  it('POST /api/ingest/blob/merge returns 500 when merge-reports fails', async () => {
    const runId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    testApp.sqlite
      .prepare('INSERT INTO blob_shards (id, run_id, shard_index, total_shards, file_path, uploaded_at, merged) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run('s-fail', runId, 1, 1, '/blob-root/aaa/shard-1.zip', '2024-01-01T00:00:00.000Z', 0);

    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: (err: Error | null) => void) => {
      cb(new Error('playwright merge-reports failed'));
    });

    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/ingest/blob/merge',
      payload: { runId },
    });

    expect(res.statusCode).toBe(500);
    const body = res.json() as { error: string; detail: string };
    expect(body.error).toBe('merge-reports failed');
    expect(body.detail).toContain('playwright merge-reports failed');
  });

  it('POST /api/ingest/blob uses application/x-zip-compressed as valid content type', async () => {
    const runId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    mockReqFile.mockResolvedValue({
      mimetype: 'application/x-zip-compressed',
      fields: {
        runId: { value: runId },
        shardIndex: { value: '1' },
        totalShards: { value: '1' },
      },
      toBuffer: vi.fn().mockResolvedValue(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00])),
    });

    const res = await testApp.app.inject({ method: 'POST', url: '/api/ingest/blob' });

    expect(res.statusCode).toBe(201);
  });

  it('POST /api/ingest/blob allShardsUploaded is true when all shards are present', async () => {
    const runId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    // Pre-insert shard 1 as already uploaded
    testApp.sqlite
      .prepare('INSERT INTO blob_shards (id, run_id, shard_index, total_shards, file_path, uploaded_at, merged) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run('pre-shard', runId, 1, 2, '/blob-root/ccc/shard-1.zip', '2024-01-01T00:00:00.000Z', 0);

    mockReqFile.mockResolvedValue({
      mimetype: 'application/zip',
      fields: {
        runId: { value: runId },
        shardIndex: { value: '2' },
        totalShards: { value: '2' },
      },
      toBuffer: vi.fn().mockResolvedValue(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00])),
    });

    const res = await testApp.app.inject({ method: 'POST', url: '/api/ingest/blob' });

    expect(res.statusCode).toBe(201);
    const body = res.json() as { allShardsUploaded: boolean };
    expect(body.allShardsUploaded).toBe(true);
  });

  it('POST /api/ingest/blob without runId/shardIndex/totalShards fields uses default fallbacks', async () => {
    // When fields are omitted, runId defaults to randomUUID(), shardIndex/totalShards default to 1
    mockWriteFile.mockResolvedValue(undefined);
    mockReqFile.mockResolvedValue({
      mimetype: 'application/zip',
      fields: {}, // no runId, no shardIndex, no totalShards
      toBuffer: vi.fn().mockResolvedValue(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00])),
    });

    const res = await testApp.app.inject({ method: 'POST', url: '/api/ingest/blob' });

    // Should succeed — runId generated by randomUUID(), defaults applied
    expect(res.statusCode).toBe(201);
    const body = res.json() as { runId: string; allShardsUploaded: boolean };
    expect(typeof body.runId).toBe('string');
    expect(body.allShardsUploaded).toBe(true);
  });
});
