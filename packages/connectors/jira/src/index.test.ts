import { afterEach, describe, expect, it, vi } from 'vitest';
import { jiraAdapter } from './index.js';

const request = { operation: 'getIssue', input: {} };

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

describe('jira adapter', () => {
  it('declares bounded issue operations', () => {
    expect(jiraAdapter.manifest.name).toBe('jira');
    expect(jiraAdapter.manifest.operations.getIssue?.sideEffecting).toBe(false);
    expect(jiraAdapter.manifest.operations.createIssue?.idempotent).toBe(false);
  });

  it('returns the parsed body and authenticates with the secret', async () => {
    // A flat `myself` response. Deliberately not wrapped in a `value` key: the
    // adapter's `data` is the whole body, and a fixture that shares a field name
    // with the retry wrapper makes the two impossible to tell apart.
    const body = { accountId: 'abc', displayName: 'Sergey' };
    const calls = stubFetchSequence([{ ok: true, status: 200, body }]);
    const result = await jiraAdapter.execute(request, 'jira-token');
    expect(result).toEqual({ status: 'ok', data: body, attempts: 1 });
    expect(calls[0]?.url).toBe('https://your-domain.atlassian.net/rest/api/3/myself');
    const headers = calls[0]?.init?.headers as Record<string, string> | undefined;
    expect(headers?.['authorization']).toBe('Bearer jira-token');
  });

  it('retries a 429 and reports the attempt it succeeded on', async () => {
    const body = { accountId: 'abc' };
    const calls = stubFetchSequence([
      { ok: false, status: 429, body: {} },
      { ok: true, status: 200, body },
    ]);
    const result = await jiraAdapter.execute(request, 'jira-token');
    expect(result).toEqual({ status: 'ok', data: body, attempts: 2 });
    expect(calls).toHaveLength(2);
  });

  it('does not retry a 400, and reports it as an error', async () => {
    const calls = stubFetchSequence([{ ok: false, status: 400, body: {} }]);
    const result = await jiraAdapter.execute(request, 'jira-token');
    expect(calls).toHaveLength(1);
    expect(result.status).toBe('error');
    expect(result.attempts).toBe(1);
    expect(result.error?.code).toBe('jira_request_failed');
  });

  it('reports the real attempt count after exhausting retries, not a hard-coded 1', async () => {
    const calls = stubFetchSequence([{ ok: false, status: 503, body: {} }]);
    const result = await jiraAdapter.execute(request, 'jira-token');
    expect(calls).toHaveLength(3);
    expect(result.status).toBe('error');
    expect(result.attempts).toBe(3);
  });

  it('never leaks the underlying failure text to the result', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('getaddrinfo ENOTFOUND')));
    const result = await jiraAdapter.execute(request, 'jira-token');
    expect(result.status).toBe('error');
    expect(result.error?.message).toBe('Jira operation failed');
    expect(JSON.stringify(result)).not.toContain('ENOTFOUND');
  });
});
