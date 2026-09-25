import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestApp, type TestApp } from '../../test/create-test-app.js';

const {
  mockExistsSync,
  mockReadFileSync,
  mockCopyFileSync,
  mockWriteFileSync,
  mockParsePlaywrightConfig,
  mockSafePath,
} = vi.hoisted(() => ({
  mockExistsSync: vi.fn<(filePath: string) => boolean>(),
  mockReadFileSync: vi.fn<(filePath: string, encoding: string) => string>(),
  mockCopyFileSync: vi.fn<(src: string, dest: string) => void>(),
  mockWriteFileSync: vi.fn<(filePath: string, content: string, encoding: string) => void>(),
  mockParsePlaywrightConfig: vi.fn<(filePath: string) => Record<string, unknown>>(),
  mockSafePath: vi.fn<(base: string, userPath: string) => string>(),
}));

let testApp: TestApp;

vi.mock('fs', () => ({
  default: {
    existsSync: mockExistsSync,
    readFileSync: mockReadFileSync,
    copyFileSync: mockCopyFileSync,
    writeFileSync: mockWriteFileSync,
  },
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
  copyFileSync: mockCopyFileSync,
  writeFileSync: mockWriteFileSync,
}));

vi.mock('../../services/config-parser.js', () => ({
  parsePlaywrightConfig: mockParsePlaywrightConfig,
}));

vi.mock('../../utils/safe-path.js', () => ({
  safePath: mockSafePath,
}));

describe('config routes', () => {
  beforeAll(async () => {
    testApp = await createTestApp();
    const { configRoutes } = await import('../config.js');
    await configRoutes(testApp.app);
    await testApp.app.ready();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockSafePath.mockImplementation((base, userPath) => `${base}/${userPath}`);
    mockExistsSync.mockReturnValue(false);
    mockReadFileSync.mockReturnValue('export default defineConfig({});');
    mockParsePlaywrightConfig.mockReturnValue({
      projects: [{ name: 'chromium' }],
      settings: { workers: 4 },
    });
  });

  afterAll(async () => {
    await testApp.app.close();
    testApp.poolConnection.close();
  });

  it('GET /api/config returns 404 when no config file found', async () => {
    mockExistsSync.mockReturnValue(false);

    const res = await testApp.app.inject({ method: 'GET', url: '/api/config' });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'No playwright.config.ts found' });
  });

  it('GET /api/config returns config content when file exists', async () => {
    mockExistsSync.mockImplementation((filePath) => filePath.endsWith('playwright.config.ts'));
    mockReadFileSync.mockReturnValue('export default defineConfig({ retries: 2 });');

    const res = await testApp.app.inject({ method: 'GET', url: '/api/config' });

    expect(res.statusCode).toBe(200);
    expect(res.json().content).toBe('export default defineConfig({ retries: 2 });');
    expect(mockReadFileSync).toHaveBeenCalledTimes(1);
  });

  it('GET /api/config with ?path= uses custom path', async () => {
    mockExistsSync.mockReturnValue(true);

    const res = await testApp.app.inject({ method: 'GET', url: '/api/config?path=configs/pw.config.ts' });

    expect(res.statusCode).toBe(200);
    expect(mockSafePath).toHaveBeenCalledWith(process.cwd(), 'configs/pw.config.ts');
  });

  it('PUT /api/config returns 404 when config is not found', async () => {
    mockExistsSync.mockReturnValue(false);

    const res = await testApp.app.inject({
      method: 'PUT',
      url: '/api/config',
      payload: { content: 'export default defineConfig({});' },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'No playwright.config.ts found' });
    expect(mockCopyFileSync).not.toHaveBeenCalled();
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });

  it('PUT /api/config returns 400 when content is empty', async () => {
    const res = await testApp.app.inject({
      method: 'PUT',
      url: '/api/config',
      payload: { content: '' },
    });

    expect(res.statusCode).toBe(400);
    const json = res.json();
    expect(json.error).toBeDefined();
    expect(json.error.fieldErrors?.content).toBeDefined();
    expect(mockCopyFileSync).not.toHaveBeenCalled();
  });

  it('PUT /api/config creates backup and writes file content', async () => {
    mockExistsSync.mockReturnValue(true);

    const res = await testApp.app.inject({
      method: 'PUT',
      url: '/api/config?path=playwright.config.ts',
      payload: { content: 'export default defineConfig({ workers: 8 });' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      saved: true,
      path: `${process.cwd()}/playwright.config.ts`,
      backup: `${process.cwd()}/playwright.config.ts.bak`,
    });
    expect(mockCopyFileSync).toHaveBeenCalledWith(
      `${process.cwd()}/playwright.config.ts`,
      `${process.cwd()}/playwright.config.ts.bak`,
    );
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      `${process.cwd()}/playwright.config.ts`,
      'export default defineConfig({ workers: 8 });',
      'utf-8',
    );
  });

  it('GET /api/config/parsed returns parsed config', async () => {
    mockExistsSync.mockReturnValue(true);
    mockParsePlaywrightConfig.mockReturnValue({
      projects: [{ name: 'webkit' }],
      settings: { retries: 1 },
    });

    const res = await testApp.app.inject({ method: 'GET', url: '/api/config/parsed?path=custom.ts' });

    expect(res.statusCode).toBe(200);
    expect(mockParsePlaywrightConfig).toHaveBeenCalledWith(`${process.cwd()}/custom.ts`);
    expect(res.json()).toEqual({
      path: `${process.cwd()}/custom.ts`,
      projects: [{ name: 'webkit' }],
      settings: { retries: 1 },
    });
  });

  it('GET /api/config/parsed returns 404 when no config exists', async () => {
    mockExistsSync.mockReturnValue(false);

    const res = await testApp.app.inject({ method: 'GET', url: '/api/config/parsed' });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'No playwright.config.ts found' });
    expect(mockParsePlaywrightConfig).not.toHaveBeenCalled();
  });

  it('GET /api/config/parsed returns 500 when parser throws', async () => {
    mockExistsSync.mockReturnValue(true);
    mockParsePlaywrightConfig.mockImplementation(() => {
      throw new Error('Invalid config syntax');
    });

    const res = await testApp.app.inject({ method: 'GET', url: '/api/config/parsed' });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: 'Invalid config syntax' });
  });
});
