import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolContext } from '@automate/connector-sdk';
import { slackManifest } from './index.js';
import { buildSlackBlocks } from './service.js';

const mockFetch = vi.fn();
const originalFetch = globalThis.fetch;

function createCtx(overrides?: Partial<ToolContext>): ToolContext {
  return {
    credentials: { webhookUrl: 'https://hooks.slack.com/test' },
    abortSignal: new AbortController().signal,
    ...overrides,
  };
}

function getHandler() {
  const tool = slackManifest.tools[0];
  if (!tool) {
    throw new Error('Expected post_summary tool to exist');
  }
  return tool.handler;
}

describe('slackManifest', () => {
  beforeAll(() => {
    globalThis.fetch = mockFetch as typeof fetch;
  });

  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({ ok: true } as Response);
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  it('exposes post_summary tool', () => {
    expect(slackManifest.tools).toHaveLength(1);
    expect(slackManifest.tools[0]?.name).toBe('post_summary');
  });

  it('post_summary with text only posts simple section block to webhook', async () => {
    const handler = getHandler();
    const ctx = createCtx();

    await handler({ text: 'QA summary text' }, ctx);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://hooks.slack.com/test',
      expect.objectContaining({ method: 'POST', signal: ctx.abortSignal }),
    );

    const [, requestInit] = mockFetch.mock.calls[0] as [string, RequestInit];
    const parsedBody = JSON.parse(String(requestInit.body)) as {
      blocks: Array<{ type: string; text?: { type: string; text: string } }>;
    };

    expect(parsedBody.blocks).toEqual([
      {
        type: 'section',
        text: { type: 'mrkdwn', text: 'QA summary text' },
      },
    ]);
  });

  it('post_summary with runId posts structured blocks from buildSlackBlocks', async () => {
    const handler = getHandler();
    const ctx = createCtx();
    const input = {
      text: 'ignored when runId exists',
      runId: 'run-12345678',
      status: 'passed',
      total: 12,
      passed: 10,
      failed: 1,
      flaky: 1,
      skipped: 0,
    };

    await handler(input, ctx);

    const [, requestInit] = mockFetch.mock.calls[0] as [string, RequestInit];
    const parsedBody = JSON.parse(String(requestInit.body)) as { blocks: unknown[] };
    const expectedBlocks = buildSlackBlocks({
      runId: 'run-12345678',
      status: 'passed',
      total: 12,
      passed: 10,
      failed: 1,
      flaky: 1,
      skipped: 0,
    });

    expect(parsedBody.blocks).toEqual(expectedBlocks);
  });

  it('post_summary success returns confirmation text', async () => {
    const handler = getHandler();

    const result = await handler({ text: 'some summary' }, createCtx());

    expect(result).toEqual({
      content: [{ type: 'text', text: 'Posted summary to Slack' }],
    });
  });

  it('post_summary webhook failure returns error text with status and isError', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    } as Response);
    const handler = getHandler();

    const result = await handler({ text: 'some summary' }, createCtx());

    expect(result).toEqual({
      content: [
        {
          type: 'text',
          text: 'Slack webhook failed: 500 Internal Server Error',
        },
      ],
      isError: true,
    });
  });

  it('post_summary sends Content-Type application/json header', async () => {
    const handler = getHandler();

    await handler({ text: 'summary' }, createCtx());

    const [, requestInit] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(requestInit.headers).toEqual({ 'Content-Type': 'application/json' });
  });

  it('post_summary uses webhookUrl from credentials', async () => {
    const handler = getHandler();
    const ctx = createCtx({
      credentials: { webhookUrl: 'https://hooks.slack.com/services/custom/url' },
    });

    await handler({ text: 'summary' }, ctx);

    expect(mockFetch).toHaveBeenCalledWith(
      'https://hooks.slack.com/services/custom/url',
      expect.any(Object),
    );
  });

  it('post_summary returns isError when fetch throws (network error)', async () => {
    mockFetch.mockRejectedValueOnce(new Error('connect ECONNREFUSED'));
    const handler = getHandler();

    await expect(handler({ text: 'summary' }, createCtx())).rejects.toThrow('connect ECONNREFUSED');
  });

  it('post_summary returns isError on 400 bad request from Slack', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
    } as Response);
    const handler = getHandler();

    const result = await handler({ text: 'bad payload' }, createCtx());

    expect(result).toEqual({
      content: [{ type: 'text', text: 'Slack webhook failed: 400 Bad Request' }],
      isError: true,
    });
  });

  it('post_summary returns isError on 404 not found (invalid webhook)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    } as Response);
    const handler = getHandler();

    const result = await handler({ text: 'no such channel' }, createCtx());

    expect(result).toEqual({
      content: [{ type: 'text', text: 'Slack webhook failed: 404 Not Found' }],
      isError: true,
    });
  });

  it('post_summary defaults to zero counts when run stats omitted with runId', async () => {
    const handler = getHandler();
    const ctx = createCtx();

    await handler({ text: 'ignored', runId: 'abc123' }, ctx);

    const [, requestInit] = mockFetch.mock.calls[0] as [string, RequestInit];
    const parsedBody = JSON.parse(String(requestInit.body)) as { blocks: unknown[] };

    const expectedBlocks = buildSlackBlocks({
      runId: 'abc123',
      status: 'unknown',
      total: 0,
      passed: 0,
      failed: 0,
      flaky: 0,
      skipped: 0,
    });
    expect(parsedBody.blocks).toEqual(expectedBlocks);
  });
});
