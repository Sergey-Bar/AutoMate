import { afterEach, describe, expect, it, vi } from 'vitest';
import { githubAdapter } from './index.js';

const request = { operation: 'getRepository', input: {} };

/**
 * A `fetch` that answers with a fixed sequence, recording every call.
 *
 * Hand-rolled rather than mocked from a library so the test asserts on what the
 * adapter *did* — the URL it reached, the attempts it made — rather than on a
 * call signature it chose in advance.
 */
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

describe('github adapter', () => {
  it('declares bounded issue operations', () => {
    expect(githubAdapter.manifest.name).toBe('github');
    expect(githubAdapter.manifest.operations.getRepository?.sideEffecting).toBe(false);
    expect(githubAdapter.manifest.operations.createIssue?.sideEffecting).toBe(true);
    expect(githubAdapter.manifest.operations.getRepository?.timeoutMs).toBe(10_000);
  });

  it('returns the parsed body on success, having called once', async () => {
    const calls = stubFetchSequence([{ ok: true, status: 200, body: { login: 'octocat' } }]);
    const result = await githubAdapter.execute(request, 'unused');
    expect(result).toEqual({ status: 'ok', data: { login: 'octocat' }, attempts: 1 });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://api.github.com');
  });

  it('passes the abort signal through, so a cancelled request really is cancelled', async () => {
    const calls = stubFetchSequence([{ ok: true, status: 200, body: {} }]);
    const controller = new AbortController();
    await githubAdapter.execute({ ...request, signal: controller.signal }, 'unused');
    expect(calls[0]?.init?.signal).toBe(controller.signal);
  });

  it('retries a 503 and reports the attempt it succeeded on', async () => {
    const calls = stubFetchSequence([
      { ok: false, status: 503, body: {} },
      { ok: true, status: 200, body: { login: 'octocat' } },
    ]);
    const result = await githubAdapter.execute(request, 'unused');
    expect(result.status).toBe('ok');
    expect(result.attempts).toBe(2);
    expect(calls).toHaveLength(2);
  });

  it('does not retry a 404, and reports it as a non-retryable error', async () => {
    const calls = stubFetchSequence([{ ok: false, status: 404, body: {} }]);
    const result = await githubAdapter.execute(request, 'unused');
    expect(calls).toHaveLength(1);
    expect(result.status).toBe('error');
    expect(result.error).toEqual({
      code: 'github_404',
      retryable: false,
      message: 'GitHub operation failed',
    });
  });

  it('reports the real attempt count after exhausting retries, not a hard-coded 1', async () => {
    // 1 initial attempt plus 2 retries: `retries: 2` in the adapter.
    const calls = stubFetchSequence([{ ok: false, status: 500, body: {} }]);
    const result = await githubAdapter.execute(request, 'unused');
    expect(calls).toHaveLength(3);
    expect(result.status).toBe('error');
    expect(result.attempts).toBe(3);
    expect(result.error?.code).toBe('github_500');
    expect(result.error?.retryable).toBe(true);
  });

  it('reports a transport failure as a 500 rather than leaking the raw error', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('ECONNREFUSED')));
    const result = await githubAdapter.execute(request, 'unused');
    expect(result).toEqual({
      status: 'error',
      error: { code: 'github_500', retryable: true, message: 'GitHub operation failed' },
      attempts: 1,
    });
  });
});
