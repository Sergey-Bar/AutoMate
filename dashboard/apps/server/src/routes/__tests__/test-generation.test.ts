import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

// ── Mock test-generator service ───────────────────────────────────────────────

const mockGenerate = vi.hoisted(() => vi.fn());

vi.mock('../../services/test-generator.js', () => ({
  generate: mockGenerate,
}));

// ── Mock fs for the save endpoint ─────────────────────────────────────────────

const {
  mockExistsSync,
  mockMkdirSync,
  mockCopyFileSync,
  mockWriteFileSync,
} = vi.hoisted(() => ({
  mockExistsSync: vi.fn<(p: string) => boolean>(),
  mockMkdirSync: vi.fn(),
  mockCopyFileSync: vi.fn(),
  mockWriteFileSync: vi.fn(),
}));

vi.mock('fs', () => ({
  existsSync: mockExistsSync,
  mkdirSync: mockMkdirSync,
  copyFileSync: mockCopyFileSync,
  writeFileSync: mockWriteFileSync,
}));

// ── App factory ───────────────────────────────────────────────────────────────

let app: FastifyInstance;

const VALID_CODE = `import { test, expect } from '@playwright/test';\n\ntest('verify dashboard', async ({ page }) => {\n  await page.goto('/');\n  await expect(page.getByRole('heading')).toBeVisible();\n});`;

describe('test-generation routes', () => {
  beforeAll(async () => {
    app = Fastify({ logger: false });
    const { testGenerationRoutes } = await import('../test-generation.js');
    await testGenerationRoutes(app);
    await app.ready();
  });

  beforeEach(() => {
    vi.resetAllMocks();
    mockExistsSync.mockReturnValue(false);
  });

  afterAll(async () => {
    await app.close();
  });

  // ── /generate ──────────────────────────────────────────────────────────────

  it('POST /api/test-generation/generate returns 200 with generated result', async () => {
    mockGenerate.mockResolvedValue({
      code: VALID_CODE,
      filename: 'verify-dashboard.spec.ts',
      confidence: 1.0,
      warnings: [],
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/test-generation/generate',
      payload: { description: 'verify the dashboard loads' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      code: VALID_CODE,
      filename: 'verify-dashboard.spec.ts',
      confidence: 1.0,
      warnings: [],
    });
    expect(mockGenerate).toHaveBeenCalledWith({
      description: 'verify the dashboard loads',
      baseUrl: undefined,
      framework: 'playwright',
    });
  });

  it('POST /api/test-generation/generate passes baseUrl to service', async () => {
    mockGenerate.mockResolvedValue({
      code: VALID_CODE,
      filename: 'test.spec.ts',
      confidence: 0.8,
      warnings: ['Missing Playwright imports'],
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/test-generation/generate',
      payload: {
        description: 'log in as admin',
        baseUrl: 'https://my-app.example.com',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(mockGenerate).toHaveBeenCalledWith({
      description: 'log in as admin',
      baseUrl: 'https://my-app.example.com',
      framework: 'playwright',
    });
  });

  it('POST /api/test-generation/generate returns 400 for empty description', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/test-generation/generate',
      payload: { description: '' },
    });

    expect(res.statusCode).toBe(400);
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it('POST /api/test-generation/generate returns 400 when description missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/test-generation/generate',
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it('POST /api/test-generation/generate returns 404 when no AI provider configured', async () => {
    mockGenerate.mockRejectedValue(new Error('No AI provider configured'));

    const res = await app.inject({
      method: 'POST',
      url: '/api/test-generation/generate',
      payload: { description: 'test login flow' },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'No AI provider configured' });
  });

  it('POST /api/test-generation/generate returns 200 when warnings are present', async () => {
    mockGenerate.mockResolvedValue({
      code: '// some code',
      filename: 'generated-test.spec.ts',
      confidence: 0.6,
      warnings: ['Missing Playwright imports', 'No test function found'],
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/test-generation/generate',
      payload: { description: 'test something' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { warnings: string[]; confidence: number };
    expect(body.warnings).toHaveLength(2);
    expect(body.confidence).toBe(0.6);
  });

  it('POST /api/test-generation/generate returns 500 for unexpected error', async () => {
    mockGenerate.mockRejectedValue(new Error('AI API error: 503 Service Unavailable'));

    const res = await app.inject({
      method: 'POST',
      url: '/api/test-generation/generate',
      payload: { description: 'test something' },
    });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: 'AI API error: 503 Service Unavailable' });
  });

  it('POST /api/test-generation/save returns 500 when writeFileSync throws', async () => {
    mockWriteFileSync.mockImplementation(() => {
      throw new Error('EACCES: permission denied');
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/test-generation/save',
      payload: {
        content: VALID_CODE,
        filePath: 'tmp/test.spec.ts',
      },
    });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: 'Failed to save file' });
  });

  // ── /save ──────────────────────────────────────────────────────────────────

  it('POST /api/test-generation/save creates directory and writes file', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/test-generation/save',
      payload: {
        content: VALID_CODE,
        filePath: 'tmp/generated/my-test.spec.ts',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { saved: boolean; path: string };
    expect(body.saved).toBe(true);
    expect(
      body.path.endsWith('tmp\\generated\\my-test.spec.ts') ||
      body.path.endsWith('tmp/generated/my-test.spec.ts'),
    ).toBe(true);
    expect(mockWriteFileSync).toHaveBeenCalledWith(body.path, VALID_CODE, 'utf-8');
  });

  it('POST /api/test-generation/save returns 400 when content missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/test-generation/save',
      payload: { filePath: 'tmp/test.spec.ts' },
    });

    expect(res.statusCode).toBe(400);
  });

  it('POST /api/test-generation/save returns 400 when filePath missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/test-generation/save',
      payload: { content: VALID_CODE },
    });

    expect(res.statusCode).toBe(400);
  });

  it('POST /api/test-generation/save backs up existing file before overwrite', async () => {
    mockExistsSync.mockImplementation((p: string) => p.endsWith('.spec.ts'));

    const res = await app.inject({
      method: 'POST',
      url: '/api/test-generation/save',
      payload: {
        content: VALID_CODE,
        filePath: 'existing/my-test.spec.ts',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(mockCopyFileSync).toHaveBeenCalledTimes(1);
  });

  it('POST /api/test-generation/save returns 400 for path traversal attempt', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/test-generation/save',
      payload: {
        content: VALID_CODE,
        filePath: '../../../etc/passwd',
      },
    });

    // safePath should throw for path traversal → 400
    expect(res.statusCode).toBe(400);
  });
});
