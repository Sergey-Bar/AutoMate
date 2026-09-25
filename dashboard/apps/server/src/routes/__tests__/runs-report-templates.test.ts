import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTestApp, type TestApp } from '../../test/create-test-app.js';

const {
  mockRunner,
  mockGenerateRunPdf,
  mockGenerateStakeholderReport,
} = vi.hoisted(() => ({
  mockRunner: {
    startRun: vi.fn<(...args: unknown[]) => Promise<string>>(),
    abortRun: vi.fn<(runId: string) => boolean>(),
    listTests: vi.fn<(configPath?: string) => Promise<object>>(),
  },
  mockGenerateRunPdf: vi.fn<(runId: string) => Promise<Buffer>>(),
  mockGenerateStakeholderReport: vi.fn<(runId: string, template: string) => Promise<Buffer>>(),
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

vi.mock('../../services/runner.js', () => ({
  runner: mockRunner,
}));

vi.mock('../../services/html-report.js', () => ({
  generateHtmlReport: vi.fn().mockReturnValue('<html></html>'),
}));

vi.mock('../../services/pdf-report.js', () => ({
  generateRunPdf: mockGenerateRunPdf,
}));

vi.mock('../../services/stakeholder-reports.js', () => ({
  generateStakeholderReport: mockGenerateStakeholderReport,
  VALID_TEMPLATES: ['release', 'quality', 'executive'],
}));

const mockBridge = { computeGateStatus: vi.fn() };

describe('runs routes — stakeholder report templates', () => {
  beforeAll(async () => {
    testApp = await createTestApp();
    const { runsRoutes } = await import('../runs.js');
    await runsRoutes(testApp.app, { bridge: mockBridge as Parameters<typeof runsRoutes>[1]['bridge'] });
    await testApp.app.ready();

    mockRunner.startRun.mockResolvedValue('run-id');
    mockRunner.abortRun.mockReturnValue(false);
    mockRunner.listTests.mockResolvedValue({ suites: [] });
    mockGenerateRunPdf.mockResolvedValue(Buffer.from('%PDF-fake'));
  });

  afterAll(async () => {
    await testApp.app.close();
    testApp.poolConnection.close();
  });

  it('GET /api/runs/:id/report/release returns PDF attachment', async () => {
    mockGenerateStakeholderReport.mockResolvedValue(Buffer.from('%PDF-release'));

    const res = await testApp.app.inject({
      method: 'GET',
      url: '/api/runs/run-abc-123/report/release',
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.headers['content-disposition']).toContain('run-abc--release-report.pdf');
    expect(mockGenerateStakeholderReport).toHaveBeenCalledWith('run-abc-123', 'release');
  });

  it('GET /api/runs/:id/report/quality returns PDF attachment', async () => {
    mockGenerateStakeholderReport.mockResolvedValue(Buffer.from('%PDF-quality'));

    const res = await testApp.app.inject({
      method: 'GET',
      url: '/api/runs/run-def-456/report/quality',
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(mockGenerateStakeholderReport).toHaveBeenCalledWith('run-def-456', 'quality');
  });

  it('GET /api/runs/:id/report/executive returns PDF attachment', async () => {
    mockGenerateStakeholderReport.mockResolvedValue(Buffer.from('%PDF-executive'));

    const res = await testApp.app.inject({
      method: 'GET',
      url: '/api/runs/run-ghi-789/report/executive',
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(mockGenerateStakeholderReport).toHaveBeenCalledWith('run-ghi-789', 'executive');
  });

  it('GET /api/runs/:id/report/:template returns 400 for invalid template', async () => {
    const res = await testApp.app.inject({
      method: 'GET',
      url: '/api/runs/some-run/report/invalid-template',
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: expect.stringContaining('invalid-template') });
  });

  it('GET /api/runs/:id/report/:template returns 404 when run not found', async () => {
    mockGenerateStakeholderReport.mockRejectedValue(new Error('Run missing not found'));

    const res = await testApp.app.inject({
      method: 'GET',
      url: '/api/runs/missing/report/release',
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: 'Run missing not found' });
  });
});
