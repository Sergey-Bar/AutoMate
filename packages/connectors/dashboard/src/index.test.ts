import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolContext } from '@automate/connector-sdk';
import { dashboardManifest } from './index.js';

function createCtx(overrides?: Partial<Record<string, string>>): ToolContext {
  return {
    credentials: {
      dashboardUrl: 'http://dashboard.test:4000',
      serviceSecret: 'test-secret',
      ...overrides,
    },
    abortSignal: new AbortController().signal,
  };
}

function getTool(name: 'triggerTestRun' | 'getRunStatus' | 'getRunResults' | 'listRecentRuns') {
  const tool = dashboardManifest.tools.find((t) => t.name === name);
  if (!tool) throw new Error(`Tool not found: ${name}`);
  return tool;
}

function mockOkResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue(JSON.stringify(body)),
  } as unknown as Response;
}

function mockErrorResponse(status: number, body = 'Error'): Response {
  return {
    ok: false,
    status,
    json: vi.fn().mockResolvedValue({ error: body }),
    text: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
}

describe('dashboardManifest', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  // ── Manifest shape ───────────────────────────────────────────────────────────

  it('exposes all four tools', () => {
    const names = dashboardManifest.tools.map((t) => t.name);
    expect(names).toContain('triggerTestRun');
    expect(names).toContain('getRunStatus');
    expect(names).toContain('getRunResults');
    expect(names).toContain('listRecentRuns');
  });

  it('has exactly four tools', () => {
    expect(dashboardManifest.tools).toHaveLength(4);
  });

  it('has correct manifest metadata', () => {
    expect(dashboardManifest.name).toBe('dashboard');
    expect(dashboardManifest.version).toBe('0.1.0');
    expect(dashboardManifest.displayName).toBe('Dashboard');
  });

  // ── triggerTestRun ───────────────────────────────────────────────────────────

  describe('triggerTestRun', () => {
    it('sends POST to /api/service/trigger-run with correct payload', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        mockOkResponse({ runId: 'run-abc', status: 'queued' }),
      );
      const tool = getTool('triggerTestRun');
      await tool.handler(
        { specCode: 'test("x", () => {})', specFileName: 'x.spec.ts' },
        createCtx(),
      );
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
      const [url, opts] = vi.mocked(globalThis.fetch).mock.calls[0] as [string, RequestInit];
      expect(url).toBe('http://dashboard.test:4000/api/service/trigger-run');
      expect(opts.method).toBe('POST');
      const parsed = JSON.parse(opts.body as string);
      expect(parsed.specCode).toBe('test("x", () => {})');
      expect(parsed.specFileName).toBe('x.spec.ts');
    });

    it('returns success message with runId and status', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        mockOkResponse({ runId: 'run-abc', status: 'queued' }),
      );
      const tool = getTool('triggerTestRun');
      const result = await tool.handler(
        { specCode: 'test("x", () => {})', specFileName: 'x.spec.ts' },
        createCtx(),
      );
      expect(result).toEqual({
        content: [{ type: 'text', text: 'Test run triggered. Run ID: run-abc, Status: queued' }],
      });
    });

    it('includes baseUrl and browser in request body when provided', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        mockOkResponse({ runId: 'run-xyz', status: 'queued' }),
      );
      const tool = getTool('triggerTestRun');
      await tool.handler(
        {
          specCode: 'test("y", () => {})',
          specFileName: 'y.spec.ts',
          baseUrl: 'http://staging.example.com',
          browser: 'firefox',
        },
        createCtx(),
      );
      const [, opts] = vi.mocked(globalThis.fetch).mock.calls[0] as [string, RequestInit];
      const parsed = JSON.parse(opts.body as string);
      expect(parsed.baseUrl).toBe('http://staging.example.com');
      expect(parsed.browser).toBe('firefox');
    });

    it('returns isError when Dashboard returns non-200', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValueOnce(mockErrorResponse(500, 'Internal Server Error'));
      const tool = getTool('triggerTestRun');
      const result = await tool.handler(
        { specCode: 'test("x", () => {})', specFileName: 'x.spec.ts' },
        createCtx(),
      );
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Failed to trigger run: 500');
    });

    it('returns isError gracefully when Dashboard is unreachable', async () => {
      vi.mocked(globalThis.fetch).mockRejectedValueOnce(new Error('ECONNREFUSED'));
      const tool = getTool('triggerTestRun');
      const result = await tool.handler(
        { specCode: 'test("x", () => {})', specFileName: 'x.spec.ts' },
        createCtx(),
      );
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe('Dashboard unreachable: ECONNREFUSED');
    });

    it('includes X-Service-Auth header with secret', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        mockOkResponse({ runId: 'run-abc', status: 'queued' }),
      );
      const tool = getTool('triggerTestRun');
      await tool.handler(
        { specCode: 'test("x", () => {})', specFileName: 'x.spec.ts' },
        createCtx({ serviceSecret: 'my-secret' }),
      );
      const [, opts] = vi.mocked(globalThis.fetch).mock.calls[0] as [string, RequestInit];
      const headers = opts.headers as Record<string, string>;
      expect(headers['X-Service-Auth']).toBe('Bearer my-secret');
    });
  });

  // ── getRunStatus ─────────────────────────────────────────────────────────────

  describe('getRunStatus', () => {
    it('sends GET to /api/runs/:runId', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        mockOkResponse({ id: 'run-123', status: 'passed' }),
      );
      const tool = getTool('getRunStatus');
      await tool.handler({ runId: 'run-123' }, createCtx());
      const [url] = vi.mocked(globalThis.fetch).mock.calls[0] as [string, RequestInit];
      expect(url).toBe('http://dashboard.test:4000/api/runs/run-123');
    });

    it('returns JSON data for a found run', async () => {
      const runData = { id: 'run-123', status: 'passed', total: 5 };
      vi.mocked(globalThis.fetch).mockResolvedValueOnce(mockOkResponse(runData));
      const tool = getTool('getRunStatus');
      const result = await tool.handler({ runId: 'run-123' }, createCtx());
      expect(result).toEqual({
        content: [{ type: 'text', text: JSON.stringify(runData, null, 2) }],
      });
    });

    it('returns isError when run not found (404)', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValueOnce(mockErrorResponse(404));
      const tool = getTool('getRunStatus');
      const result = await tool.handler({ runId: 'nonexistent' }, createCtx());
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Run not found: 404');
    });

    it('returns isError gracefully when Dashboard is unreachable', async () => {
      vi.mocked(globalThis.fetch).mockRejectedValueOnce(new Error('Network error'));
      const tool = getTool('getRunStatus');
      const result = await tool.handler({ runId: 'run-abc' }, createCtx());
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe('Dashboard unreachable: Network error');
    });

    it('includes X-Service-Auth header', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        mockOkResponse({ id: 'run-123', status: 'running' }),
      );
      const tool = getTool('getRunStatus');
      await tool.handler({ runId: 'run-123' }, createCtx({ serviceSecret: 'svc-key' }));
      const [, opts] = vi.mocked(globalThis.fetch).mock.calls[0] as [string, RequestInit];
      const headers = opts.headers as Record<string, string>;
      expect(headers['X-Service-Auth']).toBe('Bearer svc-key');
    });
  });

  // ── getRunResults ────────────────────────────────────────────────────────────

  describe('getRunResults', () => {
    it('sends GET to /api/runs/:runId/tests', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        mockOkResponse({ tests: [] }),
      );
      const tool = getTool('getRunResults');
      await tool.handler({ runId: 'run-456' }, createCtx());
      const [url] = vi.mocked(globalThis.fetch).mock.calls[0] as [string, RequestInit];
      expect(url).toBe('http://dashboard.test:4000/api/runs/run-456/tests');
    });

    it('returns test details as JSON', async () => {
      const testsData = { tests: [{ name: 'login', status: 'passed' }] };
      vi.mocked(globalThis.fetch).mockResolvedValueOnce(mockOkResponse(testsData));
      const tool = getTool('getRunResults');
      const result = await tool.handler({ runId: 'run-456' }, createCtx());
      expect(result).toEqual({
        content: [{ type: 'text', text: JSON.stringify(testsData, null, 2) }],
      });
    });

    it('returns isError when results not found (404)', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValueOnce(mockErrorResponse(404));
      const tool = getTool('getRunResults');
      const result = await tool.handler({ runId: 'missing' }, createCtx());
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Results not found: 404');
    });

    it('returns isError gracefully when Dashboard is unreachable', async () => {
      vi.mocked(globalThis.fetch).mockRejectedValueOnce(new Error('ETIMEDOUT'));
      const tool = getTool('getRunResults');
      const result = await tool.handler({ runId: 'run-456' }, createCtx());
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe('Dashboard unreachable: ETIMEDOUT');
    });

    it('includes X-Service-Auth header', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValueOnce(mockOkResponse({ tests: [] }));
      const tool = getTool('getRunResults');
      await tool.handler({ runId: 'run-456' }, createCtx({ serviceSecret: 'secret-key' }));
      const [, opts] = vi.mocked(globalThis.fetch).mock.calls[0] as [string, RequestInit];
      const headers = opts.headers as Record<string, string>;
      expect(headers['X-Service-Auth']).toBe('Bearer secret-key');
    });
  });

  // ── listRecentRuns ───────────────────────────────────────────────────────────

  describe('listRecentRuns', () => {
    it('sends GET to /api/runs?limit=10 by default', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        mockOkResponse({ runs: [] }),
      );
      const tool = getTool('listRecentRuns');
      await tool.handler({}, createCtx());
      const [url] = vi.mocked(globalThis.fetch).mock.calls[0] as [string, RequestInit];
      expect(url).toBe('http://dashboard.test:4000/api/runs?limit=10');
    });

    it('passes custom limit in query string', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        mockOkResponse({ runs: [] }),
      );
      const tool = getTool('listRecentRuns');
      await tool.handler({ limit: 25 }, createCtx());
      const [url] = vi.mocked(globalThis.fetch).mock.calls[0] as [string, RequestInit];
      expect(url).toBe('http://dashboard.test:4000/api/runs?limit=25');
    });

    it('returns runs as JSON', async () => {
      const runsData = { runs: [{ id: 'run-1', status: 'passed' }, { id: 'run-2', status: 'failed' }] };
      vi.mocked(globalThis.fetch).mockResolvedValueOnce(mockOkResponse(runsData));
      const tool = getTool('listRecentRuns');
      const result = await tool.handler({ limit: 2 }, createCtx());
      expect(result).toEqual({
        content: [{ type: 'text', text: JSON.stringify(runsData, null, 2) }],
      });
    });

    it('returns isError when request fails (500)', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValueOnce(mockErrorResponse(500));
      const tool = getTool('listRecentRuns');
      const result = await tool.handler({}, createCtx());
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Failed to list runs: 500');
    });

    it('returns isError gracefully when Dashboard is unreachable', async () => {
      vi.mocked(globalThis.fetch).mockRejectedValueOnce(new Error('connect ECONNREFUSED'));
      const tool = getTool('listRecentRuns');
      const result = await tool.handler({}, createCtx());
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe('Dashboard unreachable: connect ECONNREFUSED');
    });

    it('includes X-Service-Auth header', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValueOnce(mockOkResponse({ runs: [] }));
      const tool = getTool('listRecentRuns');
      await tool.handler({}, createCtx({ serviceSecret: 'bearer-token' }));
      const [, opts] = vi.mocked(globalThis.fetch).mock.calls[0] as [string, RequestInit];
      const headers = opts.headers as Record<string, string>;
      expect(headers['X-Service-Auth']).toBe('Bearer bearer-token');
    });
  });

  // ── credential / URL resolution ──────────────────────────────────────────────

  describe('credential and URL resolution', () => {
    it('uses DASHBOARD_URL env var when no credentials provided', async () => {
      process.env.DASHBOARD_URL = 'http://env-dashboard:9000';
      vi.mocked(globalThis.fetch).mockResolvedValueOnce(mockOkResponse({ runs: [] }));
      const tool = getTool('listRecentRuns');
      const ctx: ToolContext = { credentials: {}, abortSignal: new AbortController().signal };
      await tool.handler({}, ctx);
      const [url] = vi.mocked(globalThis.fetch).mock.calls[0] as [string, RequestInit];
      expect(url).toContain('http://env-dashboard:9000');
      delete process.env.DASHBOARD_URL;
    });

    it('uses AUTOMATE_SERVICE_SECRET env var when no credentials provided', async () => {
      process.env.AUTOMATE_SERVICE_SECRET = 'env-service-secret';
      vi.mocked(globalThis.fetch).mockResolvedValueOnce(mockOkResponse({ runs: [] }));
      const tool = getTool('listRecentRuns');
      const ctx: ToolContext = { credentials: {}, abortSignal: new AbortController().signal };
      await tool.handler({}, ctx);
      const [, opts] = vi.mocked(globalThis.fetch).mock.calls[0] as [string, RequestInit];
      const headers = opts.headers as Record<string, string>;
      expect(headers['X-Service-Auth']).toBe('Bearer env-service-secret');
      delete process.env.AUTOMATE_SERVICE_SECRET;
    });

    it('falls back to http://localhost:4000 when no URL configured', async () => {
      const saved = process.env.DASHBOARD_URL;
      delete process.env.DASHBOARD_URL;
      vi.mocked(globalThis.fetch).mockResolvedValueOnce(mockOkResponse({ runs: [] }));
      const tool = getTool('listRecentRuns');
      const ctx: ToolContext = { credentials: {}, abortSignal: new AbortController().signal };
      await tool.handler({}, ctx);
      const [url] = vi.mocked(globalThis.fetch).mock.calls[0] as [string, RequestInit];
      expect(url).toContain('http://localhost:4000');
      if (saved !== undefined) process.env.DASHBOARD_URL = saved;
    });
  });
});
