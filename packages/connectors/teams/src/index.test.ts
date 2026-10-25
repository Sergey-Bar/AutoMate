import { afterEach, describe, expect, it, vi } from 'vitest';
import { teamsAdapter } from './index.js';

type Reply = { status: number } | Error;

function stubFetch(replies: Reply[]) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  let index = 0;
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const next = replies[Math.min(index, replies.length - 1)] as Reply;
    index += 1;
    if (next instanceof Error) return Promise.reject(next);
    return Promise.resolve({ ok: next.status >= 200 && next.status < 300, status: next.status });
  });
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const WEBHOOK =
  'https://prod-01.westeurope.logic.azure.com/workflows/abc/triggers/manual/paths/invoke?sig=s';
const card = { type: 'message', attachments: [] };
const post = { operation: 'postCard', input: { message: card } };

describe('teams adapter', () => {
  it('posts the message to the Workflows URL and reports the 202 as delivered', async () => {
    const calls = stubFetch([{ status: 202 }]);
    const result = await teamsAdapter.execute(post, WEBHOOK);
    expect(result).toEqual({ status: 'ok', data: { accepted: 202 }, attempts: 1 });
    expect(calls[0]?.url).toBe(WEBHOOK);
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual(card);
    expect(calls[0]?.init?.redirect).toBe('error');
  });

  it('retries a 429, which Teams did not accept', async () => {
    const calls = stubFetch([{ status: 429 }, { status: 202 }]);
    expect(await teamsAdapter.execute(post, WEBHOOK)).toMatchObject({ status: 'ok', attempts: 2 });
    expect(calls).toHaveLength(2);
  });

  it('does not retry a 5xx after a post, which may have been accepted', async () => {
    const calls = stubFetch([{ status: 502 }, { status: 202 }]);
    const result = await teamsAdapter.execute(post, WEBHOOK);
    expect(result.error).toMatchObject({ code: 'teams_502' });
    expect(calls).toHaveLength(1);
  });

  it('treats a revoked webhook as final', async () => {
    stubFetch([{ status: 404 }]);
    expect((await teamsAdapter.execute(post, WEBHOOK)).error).toMatchObject({
      code: 'teams_404',
      retryable: false,
    });
  });

  it('refuses a webhook that is not https, or carries credentials, before any request', async () => {
    const calls = stubFetch([{ status: 202 }]);
    for (const secret of ['http://example.com/hook', 'https://u:p@example.com/hook', 'not a url']) {
      expect((await teamsAdapter.execute(post, secret)).error?.code).toBe('teams_invalid_webhook');
    }
    expect(
      (await teamsAdapter.execute({ operation: 'postCard', input: {} }, WEBHOOK)).error?.code,
    ).toBe('teams_invalid_input');
    expect(
      (await teamsAdapter.execute({ operation: 'postCard', input: null }, WEBHOOK)).error?.code,
    ).toBe('teams_invalid_input');
    expect(calls).toHaveLength(0);
  });

  it('never puts the webhook, which is the credential, in an error', async () => {
    stubFetch([new TypeError(`fetch failed: ${WEBHOOK}`)]);
    const result = await teamsAdapter.execute(post, WEBHOOK);
    expect(result.error?.code).toBe('teams_transport_failed');
    expect(JSON.stringify(result)).not.toContain('sig=s');
  });
});
