import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PAGES, githubAdapter, MAX_PAGES, RATE_LIMIT_FALLBACK_MS } from './index.js';

/**
 * The delivery reads: nine paginated, side-effect-free operations.
 *
 * Each is a walk along GitHub's `Link: rel="next"` header, bounded per call, and each
 * answers `{ items, pages, nextPage }`. The stub records every URL the adapter reached, so
 * these assert on what was requested rather than on what the adapter claims it requested.
 */

interface Reply {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

function stub(replies: Reply[]) {
  const urls: string[] = [];
  const inits: RequestInit[] = [];
  let index = 0;
  vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
    urls.push(url);
    inits.push(init);
    const reply = replies[Math.min(index, replies.length - 1)] as Reply;
    index += 1;
    return Promise.resolve({
      ok: reply.status >= 200 && reply.status < 300,
      status: reply.status,
      headers: new Headers(reply.headers ?? {}),
      json: () => Promise.resolve(reply.body ?? []),
    });
  });
  return { urls, inits };
}

const BASE = 'https://api.github.com/repos/o/r';
const next = (url: string) => ({
  link: `<${url}>; rel="next", <${BASE}/pulls?page=9>; rel="last"`,
});
const run = (operation: string, input: Record<string, unknown> = {}) =>
  githubAdapter.execute({ operation, input: { owner: 'o', repo: 'r', ...input } }, 'ghp_token');

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('the read operations are declared as reads', () => {
  it('declares all nine as not side-effecting and idempotent', () => {
    const reads = [
      'listPullRequests',
      'listPullRequestReviews',
      'listPullRequestCommits',
      'listPullRequestFiles',
      'listCommits',
      'listDeployments',
      'listDeploymentStatuses',
      'listReleases',
      'listWorkflowRuns',
    ];
    for (const name of reads) {
      expect(githubAdapter.manifest.operations[name], name).toMatchObject({
        sideEffecting: false,
        idempotent: true,
      });
    }
  });
});

describe('pagination', () => {
  it('lists every pull request, recently updated first, and follows three pages', async () => {
    const page2 = `${BASE}/pulls?state=all&per_page=100&page=2`;
    const page3 = `${BASE}/pulls?state=all&per_page=100&page=3`;
    const { urls, inits } = stub([
      { status: 200, body: [{ number: 1 }, { number: 2 }], headers: next(page2) },
      { status: 200, body: [{ number: 3 }], headers: next(page3) },
      { status: 200, body: [{ number: 4 }] },
    ]);
    const result = await run('listPullRequests');
    expect(result).toEqual({
      status: 'ok',
      data: {
        items: [{ number: 1 }, { number: 2 }, { number: 3 }, { number: 4 }],
        pages: 3,
        nextPage: null,
      },
      attempts: 3,
    });
    expect(urls).toEqual([
      `${BASE}/pulls?state=all&sort=updated&direction=desc&per_page=100&page=1`,
      page2,
      page3,
    ]);
    // Every page carries the token and no body.
    for (const init of inits) {
      expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer ghp_token');
      expect(init.body).toBeUndefined();
    }
  });

  it('stops at the page bound and says which page comes next', async () => {
    const { urls } = stub([
      { status: 200, body: [{ id: 1 }], headers: next(`${BASE}/releases?per_page=1&page=2`) },
      { status: 200, body: [{ id: 2 }], headers: next(`${BASE}/releases?per_page=1&page=3`) },
      { status: 200, body: [{ id: 3 }] },
    ]);
    const result = await run('listReleases', { maxPages: 2, perPage: '1' });
    expect(result.data).toEqual({ items: [{ id: 1 }, { id: 2 }], pages: 2, nextPage: 3 });
    expect(urls).toHaveLength(2);
    expect(urls[0]).toBe(`${BASE}/releases?per_page=1&page=1`);
  });

  it('reads at most the default number of pages when no bound is named', async () => {
    const { urls } = stub([
      { status: 200, body: [{ id: 1 }], headers: next(`${BASE}/releases?page=2`) },
    ]);
    const result = await run('listReleases');
    expect(urls).toHaveLength(DEFAULT_PAGES);
    expect(result.data).toMatchObject({ pages: DEFAULT_PAGES, nextPage: 2 });
  });

  it('reports no next page when the next link has no page number', async () => {
    stub([{ status: 200, body: [{ id: 1 }], headers: next(`${BASE}/releases?cursor=abc`) }]);
    const result = await run('listReleases', { maxPages: 1 });
    expect(result.data).toMatchObject({ pages: 1, nextPage: null });
  });

  it('starts at the page the caller names', async () => {
    const { urls } = stub([{ status: 200, body: [] }]);
    await run('listReleases', { page: 4 });
    expect(urls[0]).toBe(`${BASE}/releases?per_page=100&page=4`);
  });

  it(`refuses a bound above ${String(MAX_PAGES)}, or one that is not a whole number`, async () => {
    const { urls } = stub([{ status: 200, body: [] }]);
    for (const input of [
      { maxPages: MAX_PAGES + 1 },
      { maxPages: 0 },
      { maxPages: 'many' },
      { maxPages: true },
      { perPage: 101 },
      { page: 1.5 },
    ]) {
      const result = await run('listReleases', input);
      expect(result.error?.code, JSON.stringify(input)).toBe('github_invalid_input');
    }
    expect(urls).toHaveLength(0);
  });

  it('does not follow a next link to another origin, which would carry the token there', async () => {
    const { urls } = stub([
      {
        status: 200,
        body: [{ id: 1 }],
        headers: { link: '<https://evil.example/x?page=2>; rel="next"' },
      },
    ]);
    const result = await run('listReleases');
    expect(urls).toHaveLength(1);
    expect(result.data).toMatchObject({ pages: 1, nextPage: null });
  });

  it('ends the walk at a link header with no next relation', async () => {
    const { urls } = stub([
      {
        status: 200,
        body: [{ id: 1 }],
        headers: { link: `<${BASE}/releases?page=1>; rel="first"` },
      },
    ]);
    await run('listReleases');
    expect(urls).toHaveLength(1);
  });

  it('reads the items out of a wrapped answer, and treats a missing list as empty', async () => {
    stub([{ status: 200, body: { total_count: 1, workflow_runs: [{ id: 7 }] } }]);
    expect((await run('listWorkflowRuns')).data).toMatchObject({ items: [{ id: 7 }] });
    stub([{ status: 200, body: null }]);
    expect((await run('listWorkflowRuns')).data).toMatchObject({ items: [] });
    stub([{ status: 200, body: { message: 'not a list' } }]);
    expect((await run('listReleases')).data).toMatchObject({ items: [] });
  });
});

describe('incremental reads', () => {
  it('drops pull requests older than the cursor and stops at the first page that has one', async () => {
    const { urls } = stub([
      {
        status: 200,
        body: [{ number: 3, updated_at: '2026-10-20T00:00:00Z' }, null],
        headers: next(`${BASE}/pulls?page=2`),
      },
      {
        status: 200,
        body: [
          { number: 2, updated_at: '2026-10-10T00:00:00Z' },
          { number: 1, updated_at: '2026-09-01T00:00:00Z' },
        ],
        headers: next(`${BASE}/pulls?page=3`),
      },
      { status: 200, body: [{ number: 0, updated_at: '2026-01-01T00:00:00Z' }] },
    ]);
    const result = await run('listPullRequests', { newerThan: '2026-10-01T00:00:00Z' });
    expect(urls).toHaveLength(2);
    // An item with no timestamp is kept: nothing says it is old.
    expect(result.data).toEqual({
      items: [
        { number: 3, updated_at: '2026-10-20T00:00:00Z' },
        null,
        { number: 2, updated_at: '2026-10-10T00:00:00Z' },
      ],
      pages: 2,
      nextPage: null,
    });
  });

  it('ignores newerThan on a list that is not ordered by time', async () => {
    stub([{ status: 200, body: [{ id: 1, created_at: '2020-01-01T00:00:00Z' }] }]);
    const result = await run('listPullRequestReviews', { number: '7', newerThan: '2026-01-01' });
    expect(result.data).toMatchObject({ items: [{ id: 1 }] });
  });

  it('sends since to the commits list, with the branch', async () => {
    const { urls } = stub([{ status: 200, body: [] }]);
    await run('listCommits', { since: '2026-10-01T00:00:00Z', sha: 'main' });
    expect(urls[0]).toBe(
      `${BASE}/commits?per_page=100&page=1&since=2026-10-01T00%3A00%3A00.000Z&sha=main`,
    );
  });

  it('turns since into the created range a workflow-runs list takes', async () => {
    const { urls } = stub([{ status: 200, body: { workflow_runs: [] } }]);
    await run('listWorkflowRuns', {
      since: '2026-10-01T00:00:00Z',
      branch: 'main',
      status: 'completed',
    });
    expect(urls[0]).toBe(
      `${BASE}/actions/runs?per_page=100&page=1&created=%3E%3D2026-10-01T00%3A00%3A00.000Z&branch=main&status=completed`,
    );
  });

  it('filters deployments by environment', async () => {
    const { urls } = stub([{ status: 200, body: [] }]);
    await run('listDeployments', { environment: 'production' });
    expect(urls[0]).toBe(`${BASE}/deployments?per_page=100&page=1&environment=production`);
  });

  it('refuses a since that is not a timestamp, and a blank text filter, before any request', async () => {
    const { urls } = stub([{ status: 200, body: [] }]);
    for (const input of [{ since: 'yesterday' }, { since: 1_700_000_000 }, { sha: '  ' }]) {
      expect((await run('listCommits', input)).error?.code).toBe('github_invalid_input');
    }
    expect((await run('listPullRequests', { newerThan: 'soon' })).error?.code).toBe(
      'github_invalid_input',
    );
    expect(urls).toHaveLength(0);
  });
});

describe('path parameters are percent-encoded', () => {
  it('encodes a pull request number and a deployment id that try to climb the path', async () => {
    const { urls } = stub([{ status: 200, body: [] }]);
    await run('listPullRequestReviews', { number: '1/../2' });
    await run('listPullRequestCommits', { number: '7' });
    await run('listPullRequestFiles', { number: '7' });
    await run('listDeploymentStatuses', { deploymentId: '../x' });
    await githubAdapter.execute(
      { operation: 'listReleases', input: { owner: 'a b', repo: 'c/d' } },
      'ghp_token',
    );
    expect(urls.map((url) => url.replace(/\?.*$/u, ''))).toEqual([
      `${BASE}/pulls/1%2F..%2F2/reviews`,
      `${BASE}/pulls/7/commits`,
      `${BASE}/pulls/7/files`,
      `${BASE}/deployments/..%2Fx/statuses`,
      'https://api.github.com/repos/a%20b/c%2Fd/releases',
    ]);
  });

  it('refuses a review list with no pull request number', async () => {
    const { urls } = stub([{ status: 200, body: [] }]);
    expect((await run('listPullRequestReviews')).error?.code).toBe('github_invalid_input');
    expect(urls).toHaveLength(0);
  });
});

describe('rate limits are their own refusal, carrying the reset time', () => {
  it('reads the primary limit from x-ratelimit-reset, and does not retry against it', async () => {
    // The reset is a fixed instant, so the clock is fixed before it: an unfixed clock made
    // this test fail for good once the real date passed the reset (`max(now, reset)`).
    vi.useFakeTimers({ now: new Date('2026-10-23T12:00:00.000Z') });
    const { urls } = stub([
      {
        status: 403,
        headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1793000000' },
      },
    ]);
    const result = await run('listPullRequests');
    expect(urls).toHaveLength(1);
    expect(result).toEqual({
      status: 'error',
      error: {
        code: 'github_rate_limited',
        retryable: true,
        message: 'GitHub rate limit reached',
        retryAt: new Date(1_793_000_000_000).toISOString(),
      },
      attempts: 1,
    });
  });

  it('reads a secondary limit from retry-after', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-23T12:00:00.000Z') });
    stub([{ status: 429, headers: { 'retry-after': '30' } }]);
    const result = await run('listCommits');
    expect(result.error?.retryAt).toBe('2026-10-23T12:00:30.000Z');
  });

  it('waits a minute on a 429 that names no time', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-23T12:00:00.000Z') });
    stub([{ status: 429 }]);
    const result = await run('listCommits');
    expect(result.error?.code).toBe('github_rate_limited');
    expect(Date.parse(result.error?.retryAt as string)).toBe(
      Date.parse('2026-10-23T12:00:00.000Z') + RATE_LIMIT_FALLBACK_MS,
    );
  });

  it('keeps a 403 with no limit headers a permission refusal', async () => {
    stub([{ status: 403, headers: { 'x-ratelimit-remaining': '12' } }]);
    const result = await run('listCommits');
    expect(result.error).toEqual({
      code: 'github_403',
      retryable: false,
      message: 'GitHub operation failed',
    });
  });

  it('counts the pages read before a limit stopped the walk', async () => {
    stub([
      { status: 200, body: [{ id: 1 }], headers: next(`${BASE}/releases?page=2`) },
      { status: 429, headers: { 'retry-after': '1' } },
    ]);
    const result = await run('listReleases');
    expect(result.error?.code).toBe('github_rate_limited');
    expect(result.attempts).toBe(2);
  });
});

describe('a 4xx is not retried; a 5xx is', () => {
  it('fails a 404 at once', async () => {
    const { urls } = stub([{ status: 404 }]);
    const result = await run('listDeployments');
    expect(urls).toHaveLength(1);
    expect(result.error).toEqual({
      code: 'github_404',
      retryable: false,
      message: 'GitHub operation failed',
    });
  });

  it('retries a 502 and goes on', async () => {
    const { urls } = stub([{ status: 502 }, { status: 200, body: [{ id: 1 }] }]);
    const result = await run('listDeployments');
    expect(urls).toHaveLength(2);
    expect(result).toMatchObject({ status: 'ok', attempts: 2 });
  });

  it('gives up after the retries and counts the earlier pages too', async () => {
    stub([
      { status: 200, body: [{ id: 1 }], headers: next(`${BASE}/deployments?page=2`) },
      { status: 500 },
    ]);
    const result = await run('listDeployments');
    expect(result.error).toMatchObject({ code: 'github_500', retryable: true });
    expect(result.attempts).toBe(4);
  });

  it('reports a list whose remote never answered as a transport failure', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('ECONNRESET')));
    const result = await run('listReleases');
    expect(result.error?.code).toBe('github_transport_failed');
  });
});
