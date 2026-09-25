import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestApp, type TestApp } from '../../test/create-test-app.js';

const {
  mockExistsSync,
  mockReaddirSync,
  mockStatSync,
  mockCopyFileSync,
  mockUnlinkSync,
} = vi.hoisted(() => ({
  mockExistsSync: vi.fn<(targetPath: string) => boolean>(),
  mockReaddirSync: vi.fn<(targetPath: string, options?: unknown) => Array<{ name: string; isDirectory: () => boolean }>>(),
  mockStatSync: vi.fn<(targetPath: string) => { size: number }>(),
  mockCopyFileSync: vi.fn<(src: string, dest: string) => void>(),
  mockUnlinkSync: vi.fn<(targetPath: string) => void>(),
}));

vi.mock('fs', () => ({
  existsSync: mockExistsSync,
  readdirSync: mockReaddirSync,
  statSync: mockStatSync,
  copyFileSync: mockCopyFileSync,
  unlinkSync: mockUnlinkSync,
}));

let testApp: TestApp;

function file(name: string) {
  return { name, isDirectory: () => false };
}

describe('baselines routes', () => {
  beforeAll(async () => {
    process.env.ARTIFACTS_DIR = '/artifacts-root';
    testApp = await createTestApp();
    const { baselinesRoutes } = await import('../baselines.js');
    await baselinesRoutes(testApp.app);
    await testApp.app.ready();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(false);
    mockReaddirSync.mockReturnValue([]);
    mockStatSync.mockReturnValue({ size: 0 });
  });

  afterAll(async () => {
    await testApp.app.close();
    testApp.poolConnection.close();
  });

  it('GET /api/baselines returns empty list when artifacts directory is missing', async () => {
    const res = await testApp.app.inject({ method: 'GET', url: '/api/baselines' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('GET /api/baselines returns expected baseline entries with actual and diff paths', async () => {
    mockExistsSync.mockImplementation((targetPath) => {
      if (targetPath === '/artifacts-root') return true;
      if (targetPath.endsWith('home-actual.png')) return true;
      if (targetPath.endsWith('home-diff.png')) return true;
      return false;
    });
    mockReaddirSync.mockImplementation((targetPath) => {
      if (targetPath === '/artifacts-root') return [file('home-expected.png')];
      return [];
    });
    mockStatSync.mockReturnValue({ size: 321 });

    const res = await testApp.app.inject({ method: 'GET', url: '/api/baselines' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      {
        id: 'home-expected.png',
        testFile: '',
        snapshotName: 'home',
        expectedPath: '/artifacts/home-expected.png',
        actualPath: '/artifacts/home-actual.png',
        diffPath: '/artifacts/home-diff.png',
        hasActual: true,
        hasDiff: true,
        expectedSizeBytes: 321,
      },
    ]);
  });

  it('POST /api/baselines/:file/accept copies actual to expected and cleans up actual/diff files', async () => {
    mockExistsSync.mockImplementation((targetPath) => {
      if (targetPath.endsWith('artifacts-root\\home-expected.png') || targetPath.endsWith('artifacts-root/home-expected.png')) return true;
      if (targetPath.endsWith('artifacts-root\\home-actual.png') || targetPath.endsWith('artifacts-root/home-actual.png')) return true;
      if (targetPath.endsWith('artifacts-root\\home-diff.png') || targetPath.endsWith('artifacts-root/home-diff.png')) return true;
      return false;
    });

    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/baselines/home-expected.png/accept',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { accepted: boolean; file: string; backup: string };
    expect(body.accepted).toBe(true);
    expect(body.file).toBe('home-expected.png');
    expect(body.backup.endsWith('home-expected.png.bak')).toBe(true);
    expect(mockCopyFileSync).toHaveBeenCalledTimes(2);
    expect(mockCopyFileSync.mock.calls[0]?.[0].endsWith('home-expected.png')).toBe(true);
    expect(mockCopyFileSync.mock.calls[0]?.[1].endsWith('home-expected.png.bak')).toBe(true);
    expect(mockCopyFileSync.mock.calls[1]?.[0].endsWith('home-actual.png')).toBe(true);
    expect(mockCopyFileSync.mock.calls[1]?.[1].endsWith('home-expected.png')).toBe(true);
    expect(mockUnlinkSync.mock.calls.some((call) => call[0]?.endsWith('home-actual.png'))).toBe(true);
    expect(mockUnlinkSync.mock.calls.some((call) => call[0]?.endsWith('home-diff.png'))).toBe(true);
  });

  it('POST /api/baselines/:file/accept returns 404 when expected file is missing', async () => {
    mockExistsSync.mockReturnValue(false);

    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/baselines/home-expected.png/accept',
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'Expected file not found' });
  });

  it('POST /api/baselines/accept-all accepts all pending actual screenshots', async () => {
    mockExistsSync.mockImplementation((targetPath) => {
      if (targetPath === '/artifacts-root') return true;
      if (targetPath.endsWith('home-expected.png')) return true;
      if (targetPath.endsWith('home-diff.png')) return true;
      return false;
    });
    mockReaddirSync.mockImplementation((targetPath) => {
      if (targetPath === '/artifacts-root') return [file('home-actual.png')];
      return [];
    });

    const res = await testApp.app.inject({ method: 'POST', url: '/api/baselines/accept-all' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ accepted: 1, errors: [] });
    expect(mockCopyFileSync).toHaveBeenCalledTimes(2);
    expect(mockCopyFileSync.mock.calls[0]?.[0].endsWith('home-expected.png')).toBe(true);
    expect(mockCopyFileSync.mock.calls[0]?.[1].endsWith('home-expected.png.bak')).toBe(true);
    expect(mockCopyFileSync.mock.calls[1]?.[0].endsWith('home-actual.png')).toBe(true);
    expect(mockCopyFileSync.mock.calls[1]?.[1].endsWith('home-expected.png')).toBe(true);
    expect(mockUnlinkSync.mock.calls.some((call) => call[0]?.endsWith('home-actual.png'))).toBe(true);
    expect(mockUnlinkSync.mock.calls.some((call) => call[0]?.endsWith('home-diff.png'))).toBe(true);
  });
});
