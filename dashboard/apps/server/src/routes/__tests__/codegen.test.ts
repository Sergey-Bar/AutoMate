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

function createMockProcess(pid = 4321) {
  const processEmitter = new EventEmitter() as EventEmitter & {
    pid: number;
    killed: boolean;
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: (signal?: string) => void;
  };
  processEmitter.pid = pid;
  processEmitter.killed = false;
  processEmitter.stdout = new EventEmitter();
  processEmitter.stderr = new EventEmitter();
  processEmitter.kill = () => {
    processEmitter.killed = true;
  };
  return processEmitter;
}

describe('codegen routes', () => {
  beforeAll(async () => {
    testApp = await createTestApp();
    const { codegenRoutes } = await import('../codegen.js');
    await codegenRoutes(testApp.app);
    await testApp.app.ready();
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(false);
    await testApp.app.inject({ method: 'POST', url: '/api/codegen/stop' });
  });

  afterAll(async () => {
    await testApp.app.close();
    testApp.poolConnection.close();
  });

  it('POST /api/codegen/start starts codegen process and returns pid', async () => {
    const fakeProcess = createMockProcess(9001);
    mockSpawn.mockReturnValue(fakeProcess);

    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/codegen/start',
      payload: {
        url: 'https://example.com',
        browser: 'webkit',
        language: 'typescript',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      started: true,
      pid: 9001,
      browser: 'webkit',
      url: 'https://example.com',
      language: 'typescript',
    });
    expect(mockSpawn).toHaveBeenCalledWith(
      'npx',
      ['playwright', 'codegen', '--browser', 'webkit', '--target', 'typescript', 'https://example.com'],
      { cwd: process.cwd(), shell: false, stdio: ['pipe', 'pipe', 'pipe'] },
    );
  });

  it('POST /api/codegen/stop stops active process', async () => {
    const fakeProcess = createMockProcess(1010);
    mockSpawn.mockReturnValue(fakeProcess);
    await testApp.app.inject({
      method: 'POST',
      url: '/api/codegen/start',
      payload: { url: 'https://example.com', browser: 'chromium', language: 'typescript' },
    });

    const res = await testApp.app.inject({ method: 'POST', url: '/api/codegen/stop' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ stopped: true });
    expect(fakeProcess.killed).toBe(true);
  });

  it('GET /api/codegen/status returns running status and pid', async () => {
    const fakeProcess = createMockProcess(2222);
    mockSpawn.mockReturnValue(fakeProcess);
    await testApp.app.inject({
      method: 'POST',
      url: '/api/codegen/start',
      payload: { url: 'https://example.com', browser: 'chromium', language: 'typescript' },
    });

    const res = await testApp.app.inject({ method: 'GET', url: '/api/codegen/status' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ running: true, pid: 2222, outputLength: 0 });
  });

  it('GET /api/codegen/output returns buffered stdout and stderr', async () => {
    const fakeProcess = createMockProcess(3333);
    mockSpawn.mockReturnValue(fakeProcess);
    await testApp.app.inject({
      method: 'POST',
      url: '/api/codegen/start',
      payload: { url: 'https://example.com', browser: 'chromium', language: 'typescript' },
    });
    fakeProcess.stdout.emit('data', Buffer.from('line from out\n'));
    fakeProcess.stderr.emit('data', Buffer.from('line from err\n'));

    const res = await testApp.app.inject({ method: 'GET', url: '/api/codegen/output' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ output: 'line from out\nline from err\n' });
  });

  it('POST /api/codegen/save creates directory and writes content', async () => {
    mockExistsSync.mockImplementation((targetPath) => targetPath.endsWith('/nested'));

    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/codegen/save',
      payload: {
        content: 'import { test } from "@playwright/test";',
        filePath: 'tmp/nested/generated.spec.ts',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { saved: boolean; path: string };
    expect(body.saved).toBe(true);
    expect(body.path.endsWith('tmp\\nested\\generated.spec.ts') || body.path.endsWith('tmp/nested/generated.spec.ts')).toBe(true);
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      body.path,
      'import { test } from "@playwright/test";',
      'utf-8',
    );
  });

  it('GET /api/codegen/status returns stopped when no process is running', async () => {
    const fakeProcess = createMockProcess(4444);
    mockSpawn.mockReturnValue(fakeProcess);
    await testApp.app.inject({
      method: 'POST',
      url: '/api/codegen/start',
      payload: { url: 'https://example.com', browser: 'chromium', language: 'typescript' },
    });
    await testApp.app.inject({ method: 'POST', url: '/api/codegen/stop' });

    const res = await testApp.app.inject({ method: 'GET', url: '/api/codegen/status' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ running: false, pid: null, outputLength: 0 });
  });
});
