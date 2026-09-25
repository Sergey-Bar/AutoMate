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

describe('ingest routes', () => {
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

  it('POST /api/ingest/blob stores uploaded shard and returns 201', async () => {
    const runId = '11111111-1111-4111-8111-111111111111';
    mockReqFile.mockResolvedValue({
      mimetype: 'application/zip',
      fields: {
        runId: { value: runId },
        shardIndex: { value: '1' },
        totalShards: { value: '3' },
      },
      toBuffer: vi.fn().mockResolvedValue(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00])),
    });

    const res = await testApp.app.inject({ method: 'POST', url: '/api/ingest/blob' });

    expect(res.statusCode).toBe(201);
    const body = res.json() as {
      shardId: string;
      runId: string;
      shardIndex: number;
      totalShards: number;
      allShardsUploaded: boolean;
    };
    expect(typeof body.shardId).toBe('string');
    expect(body.runId).toBe(runId);
    expect(body.shardIndex).toBe(1);
    expect(body.totalShards).toBe(3);
    expect(body.allShardsUploaded).toBe(false);
    expect(mockMkdir).toHaveBeenCalledTimes(1);
    expect(mockMkdir.mock.calls[0]?.[0].endsWith('11111111-1111-4111-8111-111111111111')).toBe(true);
    expect(mockMkdir.mock.calls[0]?.[1]).toEqual({ recursive: true });
    expect(mockWriteFile).toHaveBeenCalledTimes(1);
    expect(mockWriteFile.mock.calls[0]?.[0].endsWith('11111111-1111-4111-8111-111111111111/shard-1.zip') || mockWriteFile.mock.calls[0]?.[0].endsWith('11111111-1111-4111-8111-111111111111\\shard-1.zip')).toBe(true);
    expect(Buffer.isBuffer(mockWriteFile.mock.calls[0]?.[1])).toBe(true);

    const rows = testApp.sqlite
      .prepare('SELECT run_id, shard_index, total_shards, file_path, merged FROM blob_shards WHERE run_id = ?')
      .all(runId) as Array<{ run_id: string; shard_index: number; total_shards: number; file_path: string; merged: number }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.run_id).toBe(runId);
    expect(rows[0]?.shard_index).toBe(1);
    expect(rows[0]?.total_shards).toBe(3);
    expect(rows[0]?.file_path.endsWith('11111111-1111-4111-8111-111111111111/shard-1.zip') || rows[0]?.file_path.endsWith('11111111-1111-4111-8111-111111111111\\shard-1.zip')).toBe(true);
    expect(rows[0]?.merged).toBe(0);
  });

  it('GET /api/ingest/blobs returns grouped shard state', async () => {
    testApp.sqlite
      .prepare('INSERT INTO blob_shards (id, run_id, shard_index, total_shards, file_path, uploaded_at, merged) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run('s1', '22222222-2222-4222-8222-222222222222', 1, 2, '/blob-root/222/shard-1.zip', '2023-11-14T22:13:20.000Z', 0);
    testApp.sqlite
      .prepare('INSERT INTO blob_shards (id, run_id, shard_index, total_shards, file_path, uploaded_at, merged) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run('s2', '22222222-2222-4222-8222-222222222222', 2, 2, '/blob-root/222/shard-2.zip', '2023-11-14T22:13:20.000Z', 0);

    const res = await testApp.app.inject({ method: 'GET', url: '/api/ingest/blobs' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      {
        runId: '22222222-2222-4222-8222-222222222222',
        shards: 2,
        totalShards: 2,
        allUploaded: true,
        merged: false,
      },
    ]);
  });

  it('POST /api/ingest/blob/merge merges unmerged shards and imports run', async () => {
    const runId = '33333333-3333-4333-8333-333333333333';
    testApp.sqlite
      .prepare('INSERT INTO blob_shards (id, run_id, shard_index, total_shards, file_path, uploaded_at, merged) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run('m1', runId, 1, 1, '/blob-root/333/shard-1.zip', '2023-11-14T22:13:20.000Z', 0);

    const report = {
      stats: {
        startTime: '2026-01-01T00:00:00.000Z',
        duration: 1200,
        expected: 1,
        skipped: 0,
        unexpected: 0,
        flaky: 0,
      },
      suites: [
        {
          title: 'suite',
          file: 'tests/sample.spec.ts',
          specs: [
            {
              title: 'sample test',
              ok: true,
              tags: [],
              tests: [
                {
                  timeout: 30000,
                  annotations: [],
                  expectedStatus: 'passed',
                  projectName: 'chromium',
                  results: [
                    {
                      workerIndex: 0,
                      status: 'passed',
                      duration: 1200,
                      startTime: '2026-01-01T00:00:00.000Z',
                      retry: 0,
                      errors: [],
                      attachments: [],
                      steps: [],
                    },
                  ],
                  status: 'passed',
                },
              ],
            },
          ],
        },
      ],
    };

    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: { timeout: number; shell: boolean }, cb: (err: Error | null, out: { stdout: string; stderr: string }) => void) => {
      cb(null, { stdout: JSON.stringify(report), stderr: '' });
    });

    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/ingest/blob/merge',
      payload: { runId },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, runId });
    expect(mockExecFile).toHaveBeenCalledTimes(1);
    expect(mockExecFile.mock.calls[0]?.[0]).toBe('npx');
    expect(mockExecFile.mock.calls[0]?.[1]).toEqual([
      'playwright',
      'merge-reports',
      '--reporter',
      'json',
      expect.stringMatching(/33333333-3333-4333-8333-333333333333$/),
    ]);
    expect(mockExecFile.mock.calls[0]?.[2]).toEqual({ timeout: 120000, shell: false });
    expect(typeof mockExecFile.mock.calls[0]?.[3]).toBe('function');

    const mergedRow = testApp.sqlite
      .prepare('SELECT merged FROM blob_shards WHERE id = ?')
      .get('m1') as { merged: number };
    expect(mergedRow.merged).toBe(1);

    const runRow = testApp.poolConnection.prepare('SELECT id, status, source FROM runs WHERE id = ?').get(runId) as {
      id: string;
      status: string;
      source: string;
    };
    expect(runRow).toEqual({ id: runId, status: 'passed', source: 'blob' });
  });

  it('POST /api/ingest/blob/merge returns 404 when no unmerged shards exist for run', async () => {
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/ingest/blob/merge',
      payload: { runId: '44444444-4444-4444-8444-444444444444' },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'No unmerged shards found for runId' });
  });

  it('GET /api/ingest/blobs returns empty array when no shards exist', async () => {
    const res = await testApp.app.inject({ method: 'GET', url: '/api/ingest/blobs' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('POST /api/ingest/blob rejects invalid content type', async () => {
    mockReqFile.mockResolvedValue({
      mimetype: 'application/json',
      fields: {
        runId: { value: '55555555-5555-5555-8555-555555555555' },
        shardIndex: { value: '1' },
        totalShards: { value: '1' },
      },
      toBuffer: vi.fn().mockResolvedValue(Buffer.from('not-a-zip')),
    });

    const res = await testApp.app.inject({ method: 'POST', url: '/api/ingest/blob' });

    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: string; received: string };
    expect(body.error).toBe('Invalid file type. Only ZIP archives are accepted.');
    expect(body.received).toBe('application/json');
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it('POST /api/ingest/blob rejects empty uploads', async () => {
    mockReqFile.mockResolvedValue({
      mimetype: 'application/zip',
      fields: {
        runId: { value: '66666666-6666-6666-8666-666666666666' },
        shardIndex: { value: '1' },
        totalShards: { value: '1' },
      },
      toBuffer: vi.fn().mockResolvedValue(Buffer.from('')),
    });

    const res = await testApp.app.inject({ method: 'POST', url: '/api/ingest/blob' });

    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: string };
    expect(body.error).toBe('Empty file uploaded');
    expect(mockWriteFile).not.toHaveBeenCalled();
  });
});
