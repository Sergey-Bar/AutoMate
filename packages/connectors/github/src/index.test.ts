import { afterEach, describe, expect, it, vi } from 'vitest';
import { githubAdapter } from './index.js';

/**
 * `getRepository` needs the repository it is asking about. It used to be called with
 * `input: {}` and the adapter fetched the API root, so these cases asserted the defect
 * rather than the behaviour.
 */
const request = { operation: 'getRepository', input: { owner: 'octocat', repo: 'hello-world' } };

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
    const result = await githubAdapter.execute(request, 'ghp_token');
    expect(result).toEqual({ status: 'ok', data: { login: 'octocat' }, attempts: 1 });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://api.github.com/repos/octocat/hello-world');
  });

  it('passes the abort signal through, so a cancelled request really is cancelled', async () => {
    const calls = stubFetchSequence([{ ok: true, status: 200, body: {} }]);
    const controller = new AbortController();
    await githubAdapter.execute({ ...request, signal: controller.signal }, 'ghp_token');
    expect(calls[0]?.init?.signal).toBe(controller.signal);
  });

  it('retries a 503 and reports the attempt it succeeded on', async () => {
    const calls = stubFetchSequence([
      { ok: false, status: 503, body: {} },
      { ok: true, status: 200, body: { login: 'octocat' } },
    ]);
    const result = await githubAdapter.execute(request, 'ghp_token');
    expect(result.status).toBe('ok');
    expect(result.attempts).toBe(2);
    expect(calls).toHaveLength(2);
  });

  it('does not retry a 404, and reports it as a non-retryable error', async () => {
    const calls = stubFetchSequence([{ ok: false, status: 404, body: {} }]);
    const result = await githubAdapter.execute(request, 'ghp_token');
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
    const result = await githubAdapter.execute(request, 'ghp_token');
    expect(calls).toHaveLength(3);
    expect(result.status).toBe('error');
    expect(result.attempts).toBe(3);
    expect(result.error?.code).toBe('github_500');
    expect(result.error?.retryable).toBe(true);
  });

  it('reports a transport failure under its own code, and as not retryable', async () => {
    // This assertion used to be `github_500, retryable: true`, and it was the conflation
    // rather than a description of it. A refused connection has no status: nothing
    // answered. Presenting it as 500 says "GitHub is unwell" — and `isRetryableStatus(500)`
    // is true, so the flag told a caller to spend its whole budget retrying a socket error
    // that would not clear. It is also indistinguishable from the `github_500` case above,
    // which is a real 500: one is a server that said it is unwell, the other is a server
    // that never said anything. A caller triaging a failure needs to tell them apart.
    vi.stubGlobal('fetch', () => Promise.reject(new Error('ECONNREFUSED')));
    const result = await githubAdapter.execute(request, 'ghp_token');
    expect(result).toEqual({
      status: 'error',
      error: {
        code: 'github_transport_failed',
        retryable: false,
        message: 'GitHub operation failed',
      },
      attempts: 1,
    });
  });
});

/**
 * The three defects finding P-12 names for this adapter, plus the operation dispatch the
 * other two rows depend on.
 *
 * The adapter took `_secret` — the name said it was ignored and it was — and sent no
 * `authorization` header at all, so every call was anonymous. It also answered the same
 * request whatever the caller asked for, and it fetched the API root rather than
 * `/repos/{owner}/{repo}`, so even `getRepository` returned the wrong thing.
 */
describe('the credential is used', () => {
  it('sends a bearer token', async () => {
    const calls = stubFetchSequence([{ ok: true, status: 200, body: { full_name: 'octo/repo' } }]);
    await githubAdapter.execute(
      { operation: 'getRepository', input: { owner: 'octo', repo: 'repo' } },
      'ghp_token',
    );

    const headers = calls[0]?.init?.headers as Record<string, string> | undefined;
    // The assertion this row exists for. Before the fix the header did not exist, so
    // every call was anonymous and every rate limit was the unauthenticated one.
    expect(headers?.['authorization']).toBe('Bearer ghp_token');
    expect(headers?.['accept']).toBe('application/vnd.github+json');
  });

  it('refuses with no secret rather than sending an anonymous request', async () => {
    const calls = stubFetchSequence([{ ok: true, status: 200, body: {} }]);
    const result = await githubAdapter.execute(
      { operation: 'getRepository', input: { owner: 'octo', repo: 'repo' } },
      '',
    );

    // An anonymous request is not a GitHub request, it is a rate-limit counter. Failing
    // here is better than succeeding into a 403 three calls later.
    expect(result.status).toBe('error');
    expect(result.error?.retryable).toBe(false);
    expect(calls).toHaveLength(0);
  });
});

describe('operation dispatch', () => {
  it('reaches the repository the input names', async () => {
    const calls = stubFetchSequence([{ ok: true, status: 200, body: { full_name: 'octo/repo' } }]);
    const result = await githubAdapter.execute(
      { operation: 'getRepository', input: { owner: 'octo', repo: 'repo' } },
      'ghp_token',
    );

    expect(result.status).toBe('ok');
    // The API root is what the old adapter fetched: a valid response containing
    // `{ "current_user_url": … }`, which is not a repository.
    expect(calls[0]?.url).toBe('https://api.github.com/repos/octo/repo');
  });

  it('posts an issue with the caller\u2019s title and body', async () => {
    const calls = stubFetchSequence([{ ok: true, status: 201, body: { number: 7 } }]);
    const result = await githubAdapter.execute(
      {
        operation: 'createIssue',
        input: { owner: 'octo', repo: 'repo', title: 'broken', body: 'here' },
      },
      'ghp_token',
    );

    expect(result.status).toBe('ok');
    expect(calls[0]?.url).toBe('https://api.github.com/repos/octo/repo/issues');
    expect(calls[0]?.init?.method).toBe('POST');
    const init = calls[0]?.init as RequestInit & { body?: string };
    expect(JSON.parse(String(init.body))).toEqual({ title: 'broken', body: 'here' });
  });

  it('omits a blank optional field rather than sending an empty string', async () => {
    // `body` is optional on a GitHub issue and `state` is optional on a repository.
    // A caller who passes whitespace has not set either one, and forwarding it turns a
    // field the caller left alone into a field the caller actively set to nothing —
    // which GitHub stores, and which then round-trips as a real value.
    const calls = stubFetchSequence([{ ok: true, status: 201, body: { number: 1 } }]);
    const result = await githubAdapter.execute(
      {
        operation: 'createIssue',
        input: { owner: 'octo', repo: 'repo', title: 'kept', body: '   ' },
      },
      'ghp_token',
    );

    expect(result.status).toBe('ok');
    const init = calls[0]?.init as RequestInit & { body?: string };
    expect(JSON.parse(String(init.body))).toEqual({ title: 'kept' });
  });

  it('refuses an operation the manifest does not declare, without a request', async () => {
    const calls = stubFetchSequence([{ ok: true, status: 200, body: {} }]);
    const result = await githubAdapter.execute({ operation: 'deleteRepo', input: {} }, 'ghp_token');

    expect(result.status).toBe('error');
    expect(result.error?.code).toBe('github_unknown_operation');
    expect(calls).toHaveLength(0);
  });

  it('refuses a create with no title, rather than opening an untitled issue', async () => {
    const calls = stubFetchSequence([{ ok: true, status: 201, body: { number: 1 } }]);
    const result = await githubAdapter.execute(
      { operation: 'createIssue', input: { owner: 'octo', repo: 'repo' } },
      'ghp_token',
    );

    expect(result.status).toBe('error');
    expect(result.error?.code).toBe('github_invalid_input');
    expect(calls).toHaveLength(0);
  });

  it('percent-encodes a repository name, so a path segment cannot become a path', async () => {
    // `owner` and `repo` are caller-supplied and go straight into a URL. Unencoded,
    // `repo: "a/../b"` reaches a different repository than the caller asked for, and the
    // call still returns 200.
    const calls = stubFetchSequence([{ ok: true, status: 200, body: {} }]);
    await githubAdapter.execute(
      { operation: 'getRepository', input: { owner: 'octo', repo: 'a/../b' } },
      'ghp_token',
    );

    expect(calls[0]?.url).toBe('https://api.github.com/repos/octo/a%2F..%2Fb');
  });
});

describe('a non-idempotent operation is not repeated after an ambiguous failure', () => {
  it('does not create a second issue from one 502', async () => {
    // Finding P-13. A 502 after the issue was created says nothing about whether the
    // create happened, so repeating it produces a duplicate and reports one failure.
    const calls = stubFetchSequence([{ ok: false, status: 502, body: {} }]);
    const result = await githubAdapter.execute(
      { operation: 'createIssue', input: { owner: 'octo', repo: 'repo', title: 'broken' } },
      'ghp_token',
    );

    expect(result.status).toBe('error');
    expect(calls).toHaveLength(1);
    expect(result.attempts).toBe(1);
  });

  it('still retries a read, which the manifest calls idempotent', async () => {
    const calls = stubFetchSequence([
      { ok: false, status: 502, body: {} },
      { ok: true, status: 200, body: { full_name: 'octo/repo' } },
    ]);
    const result = await githubAdapter.execute(
      { operation: 'getRepository', input: { owner: 'octo', repo: 'repo' } },
      'ghp_token',
    );

    expect(result.status).toBe('ok');
    expect(calls).toHaveLength(2);
  });

  it('does retry a create from a refusal the server made before doing anything', async () => {
    const calls = stubFetchSequence([
      { ok: false, status: 422, body: { message: 'Validation Failed' } },
      { ok: true, status: 201, body: { number: 1 } },
    ]);
    const result = await githubAdapter.execute(
      { operation: 'createIssue', input: { owner: 'octo', repo: 'repo', title: 'broken' } },
      'ghp_token',
    );

    // 422 is not transient, so this is *not* retried — and that is the assertion: the
    // create failed before anything was created, and a retry would fail the same way.
    expect(result.status).toBe('error');
    expect(calls).toHaveLength(1);
  });
});

describe('the reported failure names the status', () => {
  it('keeps a 404 distinguishable from a 403', async () => {
    // Before this the error code was `github_<status>` for an HTTP failure and one prose
    // string for everything else, so a caller could not tell "the repository is not there"
    // from "your token cannot see it". This case is the counterweight to the transport
    // failure above: a status that arrived is named, and a status that did not arrive is
    // not invented.
    stubFetchSequence([{ ok: false, status: 404, body: {} }]);
    const result = await githubAdapter.execute(
      { operation: 'getRepository', input: { owner: 'octo', repo: 'gone' } },
      'ghp_token',
    );

    expect(result.error?.code).toBe('github_404');
    expect(result.error?.retryable).toBe(false);
  });
});
