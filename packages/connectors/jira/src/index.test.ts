import { afterEach, describe, expect, it, vi } from 'vitest';
import { jiraAdapter } from './index.js';

/**
 * `getIssue` needs the tenant and the issue it is asking about. It used to be called with
 * `input: {}` against a hardcoded example host, so these cases asserted the defect rather
 * than the behaviour.
 */
const request = {
  operation: 'getIssue',
  input: { baseUrl: 'https://acme.atlassian.net', issueKey: 'ACME-1' },
};

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
    expect(calls[0]?.url).toBe('https://acme.atlassian.net/rest/api/3/issue/ACME-1');
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
    // The status is in the code now, so a caller can tell "the request was wrong" from
    // "the credential is wrong" without reading prose. It used to be one string for
    // every failure, which is the same defect the row names in the three named claims.
    expect(result.error?.code).toBe('jira_400');
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

/**
 * The defects finding P-12 names, which the cases above encode as expected behaviour.
 *
 * The host was a literal — `https://your-domain.atlassian.net` — so every install talked
 * to the same URL, and the test asserted it. It answered `/rest/api/3/myself` whatever was
 * asked for, so `getIssue` and `createIssue` were unreachable. And its error said
 * `retryable: true` on every failure, including the 400 above, so a caller that trusted the
 * flag spent its budget on a request that would fail identically.
 */
describe('the tenant comes from the caller, not from the source', () => {
  it('reaches the host the input names', async () => {
    const calls = stubFetchSequence([{ ok: true, status: 200, body: { accountId: 'abc' } }]);
    const result = await jiraAdapter.execute(
      { operation: 'authTest', input: { baseUrl: 'https://acme.atlassian.net' } },
      'token',
    );

    expect(result.status).toBe('ok');
    // The assertion this row exists for. Before the fix this was a literal, so an install
    // could not point at its own tenant at all.
    expect(calls[0]?.url).toBe('https://acme.atlassian.net/rest/api/3/myself');
  });

  it('refuses a request with no base URL, rather than calling the example host', async () => {
    const calls = stubFetchSequence([{ ok: true, status: 200, body: {} }]);
    const result = await jiraAdapter.execute({ operation: 'authTest', input: {} }, 'token');

    expect(result.status).toBe('error');
    expect(result.error?.code).toBe('jira_invalid_input');
    // The counterweight: without this, "refuses" and "refuses after trying the wrong host"
    // look identical from here.
    expect(calls).toHaveLength(0);
  });

  it('refuses a base URL that is not a URL at all', async () => {
    // The sibling case to the two above, and the one that reaches the `catch` around
    // `new URL`. A tenant string that is not parseable would otherwise become the
    // literal prefix of a request URL, so `new URL` fails inside the adapter and the
    // caller receives an opaque `TypeError` from the URL parser rather than a refusal
    // naming the field it got wrong. Refused with zero calls, like the others.
    const calls = stubFetchSequence([{ ok: true, status: 200, body: {} }]);
    const result = await jiraAdapter.execute(
      { operation: 'authTest', input: { baseUrl: 'acme.atlassian.net' } },
      'token',
    );

    expect(result.status).toBe('error');
    expect(result.error?.code).toBe('jira_invalid_input');
    expect(result.error?.message).not.toContain('Invalid URL');
    expect(calls).toHaveLength(0);
  });

  it('refuses a non-https base URL', async () => {
    // The base URL is caller-supplied and becomes the prefix of every request, so an
    // `http:` one sends a bearer token in clear text. This is the same rule the object
    // store applies to its endpoint, for the same reason.
    const calls = stubFetchSequence([{ ok: true, status: 200, body: {} }]);
    const result = await jiraAdapter.execute(
      { operation: 'authTest', input: { baseUrl: 'http://acme.atlassian.net' } },
      'token',
    );

    expect(result.status).toBe('error');
    expect(calls).toHaveLength(0);
  });

  it('trims a trailing slash, so the path is not doubled', async () => {
    const calls = stubFetchSequence([{ ok: true, status: 200, body: {} }]);
    await jiraAdapter.execute(
      { operation: 'authTest', input: { baseUrl: 'https://acme.atlassian.net/' } },
      'token',
    );

    expect(calls[0]?.url).toBe('https://acme.atlassian.net/rest/api/3/myself');
  });
});

describe('operation dispatch', () => {
  it('reaches the issue the input names', async () => {
    const calls = stubFetchSequence([{ ok: true, status: 200, body: { key: 'ACME-1' } }]);
    const result = await jiraAdapter.execute(
      {
        operation: 'getIssue',
        input: { baseUrl: 'https://acme.atlassian.net', issueKey: 'ACME-1' },
      },
      'token',
    );

    expect(result.status).toBe('ok');
    // The old adapter answered `/myself` for this, and returned 200 with a user object.
    expect(calls[0]?.url).toBe('https://acme.atlassian.net/rest/api/3/issue/ACME-1');
  });

  it('creates an issue from the project, type and summary the caller named', async () => {
    const calls = stubFetchSequence([{ ok: true, status: 201, body: { key: 'ACME-2' } }]);
    const result = await jiraAdapter.execute(
      {
        operation: 'createIssue',
        input: {
          baseUrl: 'https://acme.atlassian.net',
          projectKey: 'ACME',
          issueType: 'Bug',
          summary: 'the flaky test',
          description: 'again',
        },
      },
      'token',
    );

    expect(result.status).toBe('ok');
    expect(calls[0]?.url).toBe('https://acme.atlassian.net/rest/api/3/issue');
    expect(calls[0]?.init?.method).toBe('POST');
    const init = calls[0]?.init as RequestInit & { body?: string };
    expect(JSON.parse(String(init.body))).toEqual({
      fields: {
        project: { key: 'ACME' },
        issuetype: { name: 'Bug' },
        summary: 'the flaky test',
        description: 'again',
      },
    });
  });

  it('refuses an operation the manifest does not declare, without a request', async () => {
    // The manifest is the single authority for what an adapter can do, so this is the
    // one refusal. `connector-dispatch.test.ts` separately asserts that the manifest
    // and the dispatch table name the same operations for all three connectors, which
    // is what lets `dispatchFor` trust the table once the manifest has said yes.
    const calls = stubFetchSequence([{ ok: true, status: 200, body: {} }]);
    const result = await jiraAdapter.execute(
      { operation: 'deleteIssue', input: { baseUrl: 'https://acme.atlassian.net' } },
      'token',
    );

    expect(result.status).toBe('error');
    expect(result.error?.code).toBe('jira_unknown_operation');
    expect(result.error?.retryable).toBe(false);
    // A caller who guessed wrong needs the right spelling, not "no".
    expect(result.error?.message).toContain('getIssue');
    expect(calls).toHaveLength(0);
  });

  it('refuses a create with no project key, rather than creating a broken issue', async () => {
    const calls = stubFetchSequence([{ ok: true, status: 201, body: {} }]);
    const result = await jiraAdapter.execute(
      {
        operation: 'createIssue',
        input: { baseUrl: 'https://acme.atlassian.net', summary: 'no project' },
      },
      'token',
    );

    expect(result.status).toBe('error');
    expect(result.error?.code).toBe('jira_invalid_input');
    expect(calls).toHaveLength(0);
  });

  it('percent-encodes an issue key, so it cannot become a path', async () => {
    const calls = stubFetchSequence([{ ok: true, status: 200, body: {} }]);
    await jiraAdapter.execute(
      {
        operation: 'getIssue',
        input: { baseUrl: 'https://acme.atlassian.net', issueKey: 'ACME-1/../../myself' },
      },
      'token',
    );

    expect(calls[0]?.url).toBe(
      'https://acme.atlassian.net/rest/api/3/issue/ACME-1%2F..%2F..%2Fmyself',
    );
  });
});

describe('the reported failure is honest about whether retrying could help', () => {
  it('does not call a 400 retryable', async () => {
    // The case the row finds rather than names: the old error said `retryable: true` on
    // every failure, so the 400 above — which will fail identically three times — was
    // reported the same as a 503.
    stubFetchSequence([{ ok: false, status: 400, body: {} }]);
    const result = await jiraAdapter.execute(
      { operation: 'authTest', input: { baseUrl: 'https://acme.atlassian.net' } },
      'token',
    );

    expect(result.error?.retryable).toBe(false);
  });

  it('reports a 503 as retryable, because it is', async () => {
    stubFetchSequence([{ ok: false, status: 503, body: {} }]);
    const result = await jiraAdapter.execute(
      { operation: 'authTest', input: { baseUrl: 'https://acme.atlassian.net' } },
      'token',
    );

    expect(result.error?.retryable).toBe(true);
  });

  it('keeps the status in the code, so a 404 and a 403 stay distinguishable', async () => {
    stubFetchSequence([{ ok: false, status: 404, body: {} }]);
    const result = await jiraAdapter.execute(
      {
        operation: 'getIssue',
        input: { baseUrl: 'https://acme.atlassian.net', issueKey: 'X-1' },
      },
      'token',
    );

    expect(result.error?.code).toBe('jira_404');
  });
});

describe('a create is not repeated after a failure that says nothing about it', () => {
  it('does not create a second issue from one 503', async () => {
    // Finding P-13. A 503 after the issue was created is a statement about the response
    // only; repeating it produces a duplicate and reports one failure.
    const calls = stubFetchSequence([{ ok: false, status: 503, body: {} }]);
    const result = await jiraAdapter.execute(
      {
        operation: 'createIssue',
        input: {
          baseUrl: 'https://acme.atlassian.net',
          projectKey: 'ACME',
          summary: 'the flaky test',
        },
      },
      'token',
    );

    expect(result.status).toBe('error');
    expect(calls).toHaveLength(1);
    expect(result.attempts).toBe(1);
  });

  it('still retries a read, which the manifest calls idempotent', async () => {
    const calls = stubFetchSequence([
      { ok: false, status: 503, body: {} },
      { ok: true, status: 200, body: { key: 'ACME-1' } },
    ]);
    const result = await jiraAdapter.execute(
      {
        operation: 'getIssue',
        input: { baseUrl: 'https://acme.atlassian.net', issueKey: 'ACME-1' },
      },
      'token',
    );

    expect(result.status).toBe('ok');
    expect(calls).toHaveLength(2);
  });
});
