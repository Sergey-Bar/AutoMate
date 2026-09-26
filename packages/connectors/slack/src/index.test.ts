import { afterEach, describe, expect, it, vi } from 'vitest';
import { slackAdapter } from './index.js';

const request = { operation: 'authTest', input: {} };

/** @param {Array<{ ok: boolean, status: number, body: unknown }>} responses */
function stubFetchSequence(responses: Array<{ ok: boolean; status: number; body: unknown }>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  let index = 0;
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    calls.push({ url, ...(init === undefined ? {} : { init }) });
    const next = responses[Math.min(index, responses.length - 1)];
    index += 1;
    if (next === undefined) throw new Error('stubFetchSequence ran out of responses');
    return Promise.resolve({
      ok: next.ok,
      status: next.status,
      json: () => Promise.resolve(next.body),
    });
  });
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('slack adapter', () => {
  it('declares bounded message operations', () => {
    expect(slackAdapter.manifest.name).toBe('slack');
    expect(slackAdapter.manifest.operations.authTest?.sideEffecting).toBe(false);
    expect(slackAdapter.manifest.operations.postMessage?.idempotent).toBe(false);
  });

  it('posts to auth.test with a bearer token and returns the parsed body', async () => {
    const calls = stubFetchSequence([
      { ok: true, status: 200, body: { ok: true, user: 'sergey' } },
    ]);
    const result = await slackAdapter.execute(request, 'xoxb-token');
    expect(result).toEqual({ status: 'ok', data: { ok: true, user: 'sergey' }, attempts: 1 });
    expect(calls[0]?.url).toBe('https://slack.com/api/auth.test');
    expect(calls[0]?.init?.method).toBe('POST');
    const headers = calls[0]?.init?.headers as Record<string, string> | undefined;
    expect(headers?.['authorization']).toBe('Bearer xoxb-token');
  });

  it('retries a 500 and reports the attempt it succeeded on', async () => {
    const calls = stubFetchSequence([
      { ok: false, status: 500, body: {} },
      { ok: true, status: 200, body: { ok: true } },
    ]);
    const result = await slackAdapter.execute(request, 'xoxb-token');
    expect(result.status).toBe('ok');
    expect(result.attempts).toBe(2);
    expect(calls).toHaveLength(2);
  });

  it('does not retry a 401, and reports it as an error', async () => {
    const calls = stubFetchSequence([{ ok: false, status: 401, body: {} }]);
    const result = await slackAdapter.execute(request, 'xoxb-token');
    expect(calls).toHaveLength(1);
    expect(result.status).toBe('error');
    expect(result.attempts).toBe(1);
    expect(result.error?.code).toBe('slack_request_failed');
  });

  it('reports the real attempt count after exhausting retries, not a hard-coded 1', async () => {
    const calls = stubFetchSequence([{ ok: false, status: 502, body: {} }]);
    const result = await slackAdapter.execute(request, 'xoxb-token');
    expect(calls).toHaveLength(3);
    expect(result.status).toBe('error');
    expect(result.attempts).toBe(3);
  });

  it('never leaks the underlying failure text to the result', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('socket hang up')));
    const result = await slackAdapter.execute(request, 'xoxb-token');
    expect(result.status).toBe('error');
    expect(result.error?.message).toBe('Slack operation failed');
    expect(JSON.stringify(result)).not.toContain('socket hang up');
  });
});
