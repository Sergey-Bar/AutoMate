import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sendSlackRunSummary } from '../slack.js';

const mockFetch = vi.fn();

function createRunSummary(overrides: Partial<Parameters<typeof sendSlackRunSummary>[1]> = {}) {
  return {
    runId: 'run-123-uuid-value',
    status: 'failed',
    total: 100,
    passed: 90,
    failed: 8,
    flaky: 1,
    skipped: 1,
    durationMs: 45000,
    branch: 'feat/login',
    dashboardUrl: 'http://dashboard.local/runs/run-123',
    ...overrides,
  };
}

function mockResponse(init: { ok: boolean; status: number; statusText?: string; text?: string }): Response {
  return {
    ok: init.ok,
    status: init.status,
    statusText: init.statusText ?? '',
    text: async () => init.text ?? '',
  } as unknown as Response;
}

describe('sendSlackRunSummary', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockReset();
    mockFetch.mockResolvedValue(mockResponse({ ok: true, status: 200 }));
  });

  it('sends webhook payload with required blocks and dashboard link', async () => {
    const run = createRunSummary();

    await sendSlackRunSummary('https://slack.test/webhook', run);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, req] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://slack.test/webhook');
    expect(req.method).toBe('POST');
    expect(req.headers).toEqual({ 'Content-Type': 'application/json' });

    const payload = JSON.parse(String(req.body)) as {
      blocks: Array<{ type: string; text?: { text: string }; fields?: Array<{ text: string }> }>;
    };

    expect(payload.blocks[0]).toEqual(
      expect.objectContaining({
        type: 'header',
        text: expect.objectContaining({ text: ':x: Test Run FAILED' }),
      }),
    );

    expect(payload.blocks[1].fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ text: '*Run ID:*\n`run-123-`' }),
        expect.objectContaining({ text: '*Branch:*\nfeat/login' }),
        expect.objectContaining({ text: '*Pass Rate:*\n90.0%' }),
        expect.objectContaining({ text: '*Duration:*\n45s' }),
      ]),
    );

    expect(payload.blocks[2]).toEqual(
      expect.objectContaining({
        text: expect.objectContaining({
          text: ':white_check_mark: 90 passed  :x: 8 failed  :warning: 1 flaky  :fast_forward: 1 skipped',
        }),
      }),
    );

    expect(payload.blocks[3]).toEqual(
      expect.objectContaining({
        text: expect.objectContaining({ text: '<http://dashboard.local/runs/run-123|View in Dashboard →>' }),
      }),
    );
  });

  it('omits dashboard block when dashboardUrl is not provided', async () => {
    const run = createRunSummary({ dashboardUrl: undefined });
    await sendSlackRunSummary('https://slack.test/webhook', run);

    const [, req] = mockFetch.mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(String(req.body)) as { blocks: Array<{ text?: { text: string } }> };

    expect(payload.blocks).toHaveLength(3);
    expect(payload.blocks.some((b) => b.text?.text.includes('View in Dashboard'))).toBe(false);
  });

  it('uses duration N/A when durationMs is missing', async () => {
    const run = createRunSummary({ durationMs: undefined });
    await sendSlackRunSummary('https://slack.test/webhook', run);

    const [, req] = mockFetch.mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(String(req.body)) as {
      blocks: Array<{ fields?: Array<{ text: string }> }>;
    };

    expect(payload.blocks[1].fields).toEqual(
      expect.arrayContaining([expect.objectContaining({ text: '*Duration:*\nN/A' })]),
    );
  });

  it.each([
    ['passed', ':white_check_mark: Test Run PASSED'],
    ['failed', ':x: Test Run FAILED'],
    ['running', ':warning: Test Run RUNNING'],
  ])('maps status %s to proper emoji', async (status, expectedHeader) => {
    const run = createRunSummary({ status });
    await sendSlackRunSummary('https://slack.test/webhook', run);

    const [, req] = mockFetch.mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(String(req.body)) as { blocks: Array<{ text?: { text: string } }> };
    expect(payload.blocks[0].text?.text).toBe(expectedHeader);
  });

  it('throws on non-ok response', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ ok: false, status: 500, statusText: 'Internal Server Error' }));

    await expect(sendSlackRunSummary('https://slack.test/webhook', createRunSummary())).rejects.toThrow(
      'Slack webhook failed: 500 Internal Server Error',
    );
  });

  it('throws on network error when fetch rejects', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error: ECONNREFUSED'));

    await expect(sendSlackRunSummary('https://slack.test/webhook', createRunSummary())).rejects.toThrow(
      'Network error: ECONNREFUSED',
    );
  });

  it('throws on rate limit response (429)', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ ok: false, status: 429, statusText: 'Too Many Requests' }));

    await expect(sendSlackRunSummary('https://slack.test/webhook', createRunSummary())).rejects.toThrow(
      'Slack webhook failed: 429 Too Many Requests',
    );
  });

  it('shows dash for pass rate when total is zero', async () => {
    const run = createRunSummary({ total: 0, passed: 0, failed: 0, flaky: 0, skipped: 0 });
    await sendSlackRunSummary('https://slack.test/webhook', run);

    const [, req] = mockFetch.mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(String(req.body)) as {
      blocks: Array<{ fields?: Array<{ text: string }> }>;
    };

    expect(payload.blocks[1].fields).toEqual(
      expect.arrayContaining([expect.objectContaining({ text: '*Pass Rate:*\n—' })]),
    );
  });

  it('sanitizes branch name with special markdown characters', async () => {
    const run = createRunSummary({ branch: 'feat/login&danger<script>' });
    await sendSlackRunSummary('https://slack.test/webhook', run);

    const [, req] = mockFetch.mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(String(req.body)) as {
      blocks: Array<{ fields?: Array<{ text: string }> }>;
    };
    const branchField = payload.blocks[1].fields?.find((f) => f.text.startsWith('*Branch:*'));
    expect(branchField).toBeDefined();
    // escapeSlackMrkdwn should have sanitized the dangerous characters
    expect(branchField?.text).not.toContain('<script>');
  });

  it('shows N/A for branch when branch is not provided', async () => {
    const run = createRunSummary({ branch: undefined });
    await sendSlackRunSummary('https://slack.test/webhook', run);

    const [, req] = mockFetch.mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(String(req.body)) as {
      blocks: Array<{ fields?: Array<{ text: string }> }>;
    };

    const branchField = payload.blocks[1].fields?.find((f) => f.text.startsWith('*Branch:*'));
    expect(branchField).toBeDefined();
    expect(branchField?.text).toBe('*Branch:*\nN/A');
  });
});
