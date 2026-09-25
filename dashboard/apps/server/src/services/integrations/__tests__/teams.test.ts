import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sendTeamsRunSummary } from '../teams.js';

const mockFetch = vi.fn();

function createRunSummary(overrides: Partial<Parameters<typeof sendTeamsRunSummary>[1]> = {}) {
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

function mockResponse(init: { ok: boolean; status: number; statusText?: string }): Response {
  return {
    ok: init.ok,
    status: init.status,
    statusText: init.statusText ?? '',
  } as unknown as Response;
}

describe('sendTeamsRunSummary', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockReset();
    mockFetch.mockResolvedValue(mockResponse({ ok: true, status: 200 }));
  });

  it('sends adaptive card with header, facts and dashboard action', async () => {
    const run = createRunSummary();

    await sendTeamsRunSummary('https://teams.test/webhook', run);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, req] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://teams.test/webhook');
    expect(req.method).toBe('POST');

    const payload = JSON.parse(String(req.body)) as {
      attachments: Array<{ content: { body: Array<Record<string, unknown>>; actions?: Array<Record<string, string>> } }>;
    };

    const content = payload.attachments[0].content;
    const body = content.body;

    expect(body[0]).toEqual(
      expect.objectContaining({ type: 'TextBlock', text: '❌ Test Run FAILED' }),
    );

    expect(body[1]).toEqual(
      expect.objectContaining({
        type: 'FactSet',
        facts: expect.arrayContaining([
          expect.objectContaining({ title: 'Run ID', value: 'run-123-' }),
          expect.objectContaining({ title: 'Branch', value: 'feat/login' }),
          expect.objectContaining({ title: 'Pass Rate', value: '90.0%' }),
          expect.objectContaining({ title: 'Duration', value: '45s' }),
        ]),
      }),
    );

    expect(body[2]).toEqual(
      expect.objectContaining({
        text: '✅ 90 passed  ❌ 8 failed  ⚠️ 1 flaky  ⏭ 1 skipped',
      }),
    );

    expect(content.actions).toEqual([
      expect.objectContaining({
        type: 'Action.OpenUrl',
        title: 'View in Dashboard',
        url: 'http://dashboard.local/runs/run-123',
      }),
    ]);
  });

  it('does not include actions when dashboardUrl is missing', async () => {
    await sendTeamsRunSummary('https://teams.test/webhook', createRunSummary({ dashboardUrl: undefined }));

    const [, req] = mockFetch.mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(String(req.body)) as {
      attachments: Array<{ content: { actions?: unknown[] } }>;
    };

    expect(payload.attachments[0].content.actions).toBeUndefined();
  });

  it.each([
    ['passed', '✅ Test Run PASSED'],
    ['failed', '❌ Test Run FAILED'],
    ['queued', '⚠️ Test Run QUEUED'],
  ])('maps status %s to expected emoji', async (status, expectedText) => {
    await sendTeamsRunSummary('https://teams.test/webhook', createRunSummary({ status }));

    const [, req] = mockFetch.mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(String(req.body)) as {
      attachments: Array<{ content: { body: Array<{ text?: string }> } }>;
    };
    expect(payload.attachments[0].content.body[0].text).toBe(expectedText);
  });

  it('throws on non-ok response', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ ok: false, status: 400, statusText: 'Bad Request' }));

    await expect(sendTeamsRunSummary('https://teams.test/webhook', createRunSummary())).rejects.toThrow(
      'Teams webhook failed: 400 Bad Request',
    );
  });

  it('throws on network error when fetch rejects', async () => {
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED 127.0.0.1:443'));

    await expect(sendTeamsRunSummary('https://teams.test/webhook', createRunSummary())).rejects.toThrow(
      'ECONNREFUSED 127.0.0.1:443',
    );
  });

  it('throws on rate limit response (429)', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ ok: false, status: 429, statusText: 'Too Many Requests' }));

    await expect(sendTeamsRunSummary('https://teams.test/webhook', createRunSummary())).rejects.toThrow(
      'Teams webhook failed: 429 Too Many Requests',
    );
  });

  it('shows dash for pass rate when total is zero', async () => {
    await sendTeamsRunSummary('https://teams.test/webhook', createRunSummary({ total: 0, passed: 0, failed: 0, flaky: 0, skipped: 0 }));

    const [, req] = mockFetch.mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(String(req.body)) as {
      attachments: Array<{ content: { body: Array<{ facts?: Array<{ title: string; value: string }> }> } }>;
    };
    const facts = payload.attachments[0].content.body[1].facts ?? [];
    const passRateFact = facts.find((f) => f.title === 'Pass Rate');
    expect(passRateFact?.value).toBe('—');
  });

  it('sends correct adaptive card structure with proper content type', async () => {
    await sendTeamsRunSummary('https://teams.test/webhook', createRunSummary());

    const [, req] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(req.headers).toEqual({ 'Content-Type': 'application/json' });

    const payload = JSON.parse(String(req.body)) as {
      type: string;
      attachments: Array<{ contentType: string; content: { type: string; version: string } }>;
    };
    expect(payload.type).toBe('message');
    expect(payload.attachments[0].contentType).toBe('application/vnd.microsoft.card.adaptive');
    expect(payload.attachments[0].content.type).toBe('AdaptiveCard');
    expect(payload.attachments[0].content.version).toBe('1.4');
  });

  it('shows N/A duration when durationMs is not provided', async () => {
    await sendTeamsRunSummary('https://teams.test/webhook', createRunSummary({ durationMs: undefined }));

    const [, req] = mockFetch.mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(String(req.body)) as {
      attachments: Array<{ content: { body: Array<{ facts?: Array<{ title: string; value: string }> }> } }>;
    };
    const facts = payload.attachments[0].content.body[1].facts ?? [];
    const durationFact = facts.find((f) => f.title === 'Duration');
    expect(durationFact?.value).toBe('N/A');
  });

  it('shows N/A branch when branch is not provided', async () => {
    await sendTeamsRunSummary('https://teams.test/webhook', createRunSummary({ branch: undefined }));

    const [, req] = mockFetch.mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(String(req.body)) as {
      attachments: Array<{ content: { body: Array<{ facts?: Array<{ title: string; value: string }> }> } }>;
    };
    const facts = payload.attachments[0].content.body[1].facts ?? [];
    const branchFact = facts.find((f) => f.title === 'Branch');
    expect(branchFact?.value).toBe('N/A');
  });
});
