/**
 * Branch coverage for codegen routes.
 * Targets: spawn error (line 84), save-file already exists (backup),
 * save with directory that doesn't exist (mkdirSync),
 * save when writeFileSync throws (500), invalid filePath (400)
 */
import { EventEmitter } from 'node:events';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestApp, type TestApp } from '../../test/create-test-app.js';

const {
  mockSpawn,
  mockExistsSync,
  mockMkdirSync,
  mockCopyFileSync,
  mockWriteFileSync,
} = vi.hoisted(() => ({
  mockSpawn: vi.fn(),
  mockExistsSync: vi.fn<(targetPath: string) => boolean>(),
  mockMkdirSync: vi.fn<(targetPath: string, opts: { recursive: true }) => void>(),
  mockCopyFileSync: vi.fn<(src: string, dest: string) => void>(),
  mockWriteFileSync: vi.fn<(targetPath: string, content: string, encoding: string) => void>(),
}));

vi.mock('child_process', () => ({
  spawn: mockSpawn,
}));

vi.mock('fs', () => ({
  existsSync: mockExistsSync,
  mkdirSync: mockMkdirSync,
  copyFileSync: mockCopyFileSync,
  writeFileSync: mockWriteFileSync,
}));

let testApp: TestApp;

describe('codegen routes — branch coverage', () => {
  beforeAll(async () => {
    testApp = await createTestApp();
    const { codegenRoutes } = await import('../codegen.js');
    await codegenRoutes(testApp.app);
    await testApp.app.ready();
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(false);
    // Ensure no running process
    await testApp.app.inject({ method: 'POST', url: '/api/codegen/stop' });
  });

  afterAll(async () => {
    await testApp.app.close();
    testApp.poolConnection.close();
  });

  it('POST /api/codegen/start returns 500 when spawn throws', async () => {
    mockSpawn.mockImplementation(() => {
      throw new Error('spawn ENOENT');
    });

    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/codegen/start',
      payload: {
        url: 'https://example.com',
        browser: 'chromium',
        language: 'typescript',
      },
    });

    expect(res.statusCode).toBe(500);
    const body = res.json() as { error: string };
    expect(body.error).toContain('spawn ENOENT');
  });

  it('POST /api/codegen/start kills existing process before starting a new one', async () => {
    const fakeProcess1 = new EventEmitter() as EventEmitter & {
      pid: number; killed: boolean;
      stdout: EventEmitter; stderr: EventEmitter;
      kill: (signal?: string) => void;
    };
    fakeProcess1.pid = 111;
    fakeProcess1.killed = false;
    fakeProcess1.stdout = new EventEmitter();
    fakeProcess1.stderr = new EventEmitter();
    fakeProcess1.kill = () => { fakeProcess1.killed = true; };

    const fakeProcess2 = new EventEmitter() as EventEmitter & {
      pid: number; killed: boolean;
      stdout: EventEmitter; stderr: EventEmitter;
      kill: (signal?: string) => void;
    };
    fakeProcess2.pid = 222;
    fakeProcess2.killed = false;
    fakeProcess2.stdout = new EventEmitter();
    fakeProcess2.stderr = new EventEmitter();
    fakeProcess2.kill = () => { fakeProcess2.killed = true; };

    mockSpawn
      .mockReturnValueOnce(fakeProcess1)
      .mockReturnValueOnce(fakeProcess2);

    // Start first process
    await testApp.app.inject({
      method: 'POST',
      url: '/api/codegen/start',
      payload: { url: 'https://example.com', browser: 'chromium', language: 'typescript' },
    });

    // Start second process — should kill the first
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/codegen/start',
      payload: { url: 'https://other.com', browser: 'firefox', language: 'javascript' },
    });

    expect(res.statusCode).toBe(200);
    expect(fakeProcess1.killed).toBe(true);
    expect(res.json()).toMatchObject({ pid: 222, browser: 'firefox' });
  });

  it('POST /api/codegen/save returns 400 for path traversal', async () => {
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/codegen/save',
      payload: {
        content: 'malicious',
        filePath: '../../../etc/passwd',
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'Invalid file path' });
  });

  it('POST /api/codegen/save creates dir when it does not exist', async () => {
    mockExistsSync.mockReturnValue(false); // dir does NOT exist

    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/codegen/save',
      payload: {
        content: 'test content',
        filePath: 'tests/generated.spec.ts',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(mockMkdirSync).toHaveBeenCalledWith(expect.any(String), { recursive: true });
    expect(mockWriteFileSync).toHaveBeenCalled();
  });

  it('POST /api/codegen/save backs up existing file before overwriting', async () => {
    // existsSync returns true for dir AND for the file itself
    mockExistsSync.mockReturnValue(true);

    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/codegen/save',
      payload: {
        content: 'new content',
        filePath: 'tests/existing.spec.ts',
      },
    });

    expect(res.statusCode).toBe(200);
    // copyFileSync should have been called to back up
    expect(mockCopyFileSync).toHaveBeenCalledTimes(1);
    const [src, dest] = mockCopyFileSync.mock.calls[0];
    expect(typeof src).toBe('string');
    expect(typeof dest).toBe('string');
    expect((dest as string).endsWith('.bak')).toBe(true);
  });

  it('POST /api/codegen/save returns 500 when writeFileSync throws', async () => {
    mockExistsSync.mockReturnValue(true); // dir exists
    mockWriteFileSync.mockImplementation(() => { throw new Error('write failed'); });

    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/codegen/save',
      payload: {
        content: 'some content',
        filePath: 'tests/write-fail.spec.ts',
      },
    });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: 'Failed to save file' });
  });

  it('POST /api/codegen/save returns 400 when content is empty', async () => {
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/codegen/save',
      payload: {
        content: '',
        filePath: 'tests/empty.spec.ts',
      },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: string };
    expect(body.error).toBeDefined();
  });

  it('POST /api/codegen/start with outputPath includes --output argument', async () => {
    const fakeProcess = new EventEmitter() as EventEmitter & {
      pid: number; killed: boolean;
      stdout: EventEmitter; stderr: EventEmitter;
      kill: (signal?: string) => void;
    };
    fakeProcess.pid = 777;
    fakeProcess.killed = false;
    fakeProcess.stdout = new EventEmitter();
    fakeProcess.stderr = new EventEmitter();
    fakeProcess.kill = () => { fakeProcess.killed = true; };
    mockSpawn.mockReturnValue(fakeProcess);

    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/codegen/start',
      payload: {
        url: 'https://example.com',
        browser: 'chromium',
        language: 'typescript',
        outputPath: 'tests/generated.spec.ts',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(mockSpawn).toHaveBeenCalledWith(
      'npx',
      expect.arrayContaining(['--output', 'tests/generated.spec.ts']),
      expect.any(Object),
    );
  });
});
