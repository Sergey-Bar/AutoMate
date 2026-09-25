/**
 * Branch coverage for baselines routes.
 * Targets: scan with nested dirs (.expected.png), accept-all error case,
 * accept when diff doesn't exist, compare routes, invalid path
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestApp, type TestApp } from '../../test/create-test-app.js';

const {
  mockExistsSync,
  mockReaddirSync,
  mockStatSync,
  mockCopyFileSync,
  mockUnlinkSync,
  mockDiffWithPixelmatch,
  mockDiffWithLooksSame,
  mockDiffWithPipeline,
  mockGetAiProvider,
} = vi.hoisted(() => ({
  mockExistsSync: vi.fn<(targetPath: string) => boolean>(),
  mockReaddirSync: vi.fn<(targetPath: string, options?: unknown) => Array<{ name: string; isDirectory: () => boolean }>>(),
  mockStatSync: vi.fn<(targetPath: string) => { size: number }>(),
  mockCopyFileSync: vi.fn<(src: string, dest: string) => void>(),
  mockUnlinkSync: vi.fn<(targetPath: string) => void>(),
  mockDiffWithPixelmatch: vi.fn(),
  mockDiffWithLooksSame: vi.fn(),
  mockDiffWithPipeline: vi.fn(),
  mockGetAiProvider: vi.fn(),
}));

vi.mock('fs', () => ({
  existsSync: mockExistsSync,
  readdirSync: mockReaddirSync,
  statSync: mockStatSync,
  copyFileSync: mockCopyFileSync,
  unlinkSync: mockUnlinkSync,
}));

vi.mock('../../services/screenshot-diff.js', () => ({
  diffWithPixelmatch: mockDiffWithPixelmatch,
  diffWithLooksSame: mockDiffWithLooksSame,
  diffWithPipeline: mockDiffWithPipeline,
}));

vi.mock('../../services/ai-provider-registry.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/ai-provider-registry.js')>();
  return {
    ...actual,
    getAiProvider: mockGetAiProvider,
  };
});

let testApp: TestApp;

function file(name: string) {
  return { name, isDirectory: () => false };
}

function dir(name: string) {
  return { name, isDirectory: () => true };
}

describe('baselines routes — branch coverage', () => {
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

  it('GET /api/baselines handles nested directories (scanDir recursion)', async () => {
    // This test just verifies scanDir is called recursively without errors
    // by returning a directory entry that also has no files
    mockExistsSync.mockImplementation((targetPath: string) => {
      if (targetPath === '/artifacts-root') return true;
      return false;
    });
    mockReaddirSync.mockImplementation((targetPath: string) => {
      if (targetPath === '/artifacts-root') return [dir('emptysubdir')];
      // empty subdir
      return [];
    });
    mockStatSync.mockReturnValue({ size: 0 });

    const res = await testApp.app.inject({ method: 'GET', url: '/api/baselines' });
    expect(res.statusCode).toBe(200);
    // Empty because subdir has no expected files
    expect(res.json()).toEqual([]);
  });

  it('GET /api/baselines scans extra snapshot directories when they exist', async () => {
    // Cover line 81: scanDir(sdPath) when existsSync returns true for extra dirs
    mockExistsSync.mockImplementation((targetPath: string) => {
      if (targetPath === '/artifacts-root') return false; // ARTIFACTS_DIR doesn't exist
      if (targetPath.includes('__screenshots__') || targetPath.includes('screenshots')) return true;
      return false;
    });
    mockReaddirSync.mockImplementation((targetPath: string) => {
      if (targetPath.includes('__screenshots__') || targetPath.includes('screenshots')) {
        return [file('home-expected.png')];
      }
      return [];
    });
    mockStatSync.mockReturnValue({ size: 100 });

    const res = await testApp.app.inject({ method: 'GET', url: '/api/baselines' });
    expect(res.statusCode).toBe(200);
    // Should find baselines from the snapshot dir
    const body = res.json() as Array<{ snapshotName: string }>;
    expect(body.length).toBeGreaterThan(0);
  });

  it('GET /api/baselines handles .expected.png extension (dot variant)', async () => {
    mockExistsSync.mockImplementation((targetPath) => {
      if (targetPath === '/artifacts-root') return true;
      return false;
    });
    mockReaddirSync.mockImplementation((targetPath) => {
      if (targetPath === '/artifacts-root') return [file('btn.expected.png')];
      return [];
    });
    mockStatSync.mockReturnValue({ size: 100 });

    const res = await testApp.app.inject({ method: 'GET', url: '/api/baselines' });

    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<{ snapshotName: string }>;
    expect(body).toHaveLength(1);
    expect(body[0].snapshotName).toBe('btn');
  });

  it('POST /api/baselines/:file/accept returns 404 when actual file is missing', async () => {
    mockExistsSync.mockImplementation((targetPath) => {
      // Expected exists, but actual does NOT exist
      if (targetPath.endsWith('home-expected.png') && !targetPath.endsWith('home-actual.png')) return true;
      return false;
    });

    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/baselines/home-expected.png/accept',
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'No actual file to accept' });
  });

  it('POST /api/baselines/:file/accept when diff does not exist, skips diff deletion', async () => {
    mockExistsSync.mockImplementation((targetPath) => {
      if (targetPath.endsWith('home-expected.png') && !targetPath.includes('actual') && !targetPath.includes('diff')) return true;
      if (targetPath.endsWith('home-actual.png')) return true;
      // diff does NOT exist
      return false;
    });

    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/baselines/home-expected.png/accept',
    });

    expect(res.statusCode).toBe(200);
    // unlink should only be called for actual, NOT for diff
    const unlinkCalls = mockUnlinkSync.mock.calls.map((c) => c[0]);
    expect(unlinkCalls.some((p) => typeof p === 'string' && p.endsWith('home-actual.png'))).toBe(true);
    expect(unlinkCalls.some((p) => typeof p === 'string' && p.endsWith('home-diff.png'))).toBe(false);
  });

  it('POST /api/baselines/:file/accept returns 400 for path traversal', async () => {
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/baselines/..%2F..%2Fetc%2Fpasswd/accept',
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'Invalid file path' });
  });

  it('POST /api/baselines/accept-all handles file copy errors gracefully', async () => {
    mockExistsSync.mockImplementation((targetPath) => {
      if (targetPath === '/artifacts-root') return true;
      return false;
    });
    mockReaddirSync.mockImplementation((targetPath) => {
      if (targetPath === '/artifacts-root') return [file('home-actual.png')];
      return [];
    });
    mockCopyFileSync.mockImplementationOnce(() => { throw new Error('Permission denied'); });

    const res = await testApp.app.inject({ method: 'POST', url: '/api/baselines/accept-all' });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { accepted: number; errors: string[] };
    expect(body.accepted).toBe(0);
    expect(body.errors).toContain('home-actual.png');
  });

  it('POST /api/baselines/accept-all processes subdirectory structure (covers processDir recursion)', async () => {
    // processDir recurses into directories - just test it doesn't crash on subdir
    mockExistsSync.mockImplementation((targetPath: string) => {
      if (targetPath === '/artifacts-root') return true;
      return false;
    });
    mockReaddirSync.mockImplementation((targetPath: string) => {
      if (targetPath === '/artifacts-root') return [dir('emptysubdir')];
      return [];
    });

    const res = await testApp.app.inject({ method: 'POST', url: '/api/baselines/accept-all' });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { accepted: number; errors: string[] };
    expect(body.accepted).toBe(0);
    expect(body.errors).toHaveLength(0);
  });

  it('POST /api/baselines/:file/compare returns 400 for invalid path', async () => {
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/baselines/..%2F..%2Fetc%2Fpasswd/compare',
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'Invalid file path' });
  });

  it('POST /api/baselines/:file/compare returns 404 when expected file missing', async () => {
    mockExistsSync.mockReturnValue(false);

    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/baselines/missing-expected.png/compare',
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'Expected file not found' });
  });

  it('POST /api/baselines/:file/compare returns 404 when actual file missing', async () => {
    mockExistsSync.mockImplementation((targetPath) => {
      return targetPath.endsWith('btn-expected.png') && !targetPath.endsWith('btn-actual.png');
    });

    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/baselines/btn-expected.png/compare',
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'No actual file to compare' });
  });

  it('POST /api/baselines/:file/compare returns diff result from pixelmatch', async () => {
    mockExistsSync.mockReturnValue(true);
    mockDiffWithPipeline.mockResolvedValue({ diffPixels: 5, diffPercent: 0.1, diffStage: 'pixel' });

    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/baselines/btn-expected.png/compare',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ diffPixels: 5, diffPercent: 0.1, diffStage: 'pixel' });
    expect(mockDiffWithPipeline).toHaveBeenCalledTimes(1);
  });

  it('POST /api/baselines/:file/compare-looks-same returns 400 for invalid path', async () => {
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/baselines/..%2Fetc%2Fpasswd/compare-looks-same',
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'Invalid file path' });
  });

  it('POST /api/baselines/:file/compare-looks-same returns 404 when expected missing', async () => {
    mockExistsSync.mockReturnValue(false);

    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/baselines/btn-expected.png/compare-looks-same',
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'Expected file not found' });
  });

  it('POST /api/baselines/:file/compare-looks-same returns 404 when actual missing', async () => {
    mockExistsSync.mockImplementation((targetPath) => {
      return targetPath.endsWith('btn-expected.png') && !targetPath.endsWith('btn-actual.png');
    });

    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/baselines/btn-expected.png/compare-looks-same',
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'No actual file to compare' });
  });

  it('POST /api/baselines/:file/compare-looks-same returns diff result from looks-same', async () => {
    mockExistsSync.mockReturnValue(true);
    mockDiffWithLooksSame.mockResolvedValue({ equal: false, diffBounds: { left: 0, top: 0 } });

    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/baselines/btn-expected.png/compare-looks-same',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ equal: false, diffBounds: { left: 0, top: 0 } });
    expect(mockDiffWithLooksSame).toHaveBeenCalledTimes(1);
  });

  it('POST /api/baselines/:file/compare uses AI config when getAiProvider succeeds', async () => {
    mockExistsSync.mockReturnValue(true);
    const aiConfig = { provider: 'openai', model: 'gpt-4o', apiKey: 'key', visionDiffEnabled: true };
    mockGetAiProvider.mockResolvedValue({ config: aiConfig, adapter: {} });
    mockDiffWithPipeline.mockResolvedValue({
      diffCount: 10,
      totalPixels: 100,
      diffPercentage: 10,
      diffImagePath: '/tmp/diff.png',
      width: 10,
      height: 10,
      diffStage: 'ai',
      aiAnalysis: { significant: true, description: 'Layout shifted', regions: [] },
    });

    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/baselines/btn-expected.png/compare',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body.diffStage).toBe('ai');
    expect(body.aiAnalysis).toEqual({ significant: true, description: 'Layout shifted' });
    expect(mockDiffWithPipeline).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      aiConfig,
    );
  });
});
