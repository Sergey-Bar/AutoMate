import {
  attemptsOf,
  ConnectorHttpError,
  ConnectorInputError,
  ConnectorRejectionError,
  executeWithRetry,
  isRetryableStatus,
  requireString,
  type ConnectorAdapter,
  type ConnectorRequest,
  type ConnectorResult,
} from '@automate/connectors-sdk';

/**
 * The GitHub REST API.
 *
 * Three defects, all in the same file, all invisible from the tests that existed:
 *
 *  - the credential was bound to `_secret` and never sent, so every call was anonymous
 *    and every rate limit was the unauthenticated one;
 *  - every request went to the API *root*, which answers 200 with a handful of URLs, so
 *    `getRepository` returned a valid response that was not a repository;
 *  - the operation the caller named was never read.
 *
 * The last one is the root of the other two, and the reason the dispatch table is held
 * separately from the manifest and cross-checked against it by a test: a manifest entry
 * with no dispatch entry is an operation a caller can read about and cannot call, and
 * that is exactly the shape of the defect.
 *
 * **A repository name goes into a URL, so it is percent-encoded.** `owner` and `repo` are
 * caller-supplied; unencoded, `repo: "a/../b"` reaches a different repository and still
 * answers 200, which is a read the caller believes and never made.
 */

const API = 'https://api.github.com';

interface GitHubOperation {
  /** The path, from the owner, the repository and the validated input. */
  readonly path: (owner: string, repo: string, input: Record<string, unknown>) => string;
  readonly method: 'GET' | 'POST' | 'PATCH';
  /** Required input fields beyond `owner` and `repo`. */
  readonly fields: readonly string[];
  /** Fields sent in the body, when there is a body. */
  readonly bodyFields: readonly string[];
  /** Set on a paginated read: see {@link GitHubList}. */
  readonly list?: GitHubList;
}

/**
 * A paginated read: what it sends, and where its items are in the answer.
 *
 * Every list answers `{ items, pages, nextPage }` — the items of every page read, how many
 * pages that was, and the page to ask for next when the per-call bound stopped the walk
 * (`null` when the list was read to its end). The bound is the caller's `maxPages`, at most
 * {@link MAX_PAGES}, so one call can never page through a repository's whole history.
 */
interface GitHubList {
  /** Query parameters every request of this list carries. */
  readonly query?: Readonly<Record<string, string>>;
  /** Optional caller fields this list sends as query parameters. */
  readonly params?: readonly ListParam[];
  /** The array in the body; absent, the body *is* the array. */
  readonly itemsKey?: string;
  /**
   * The timestamp each item is ordered by, newest first. With it, a caller's `newerThan`
   * drops the items older than that instant and stops the walk at the first page that
   * had one: everything after it is older still. This is the incremental read GitHub
   * offers for lists that have no `since`.
   */
  readonly orderedBy?: string;
}

interface ListParam {
  /** The input field. */
  readonly field: string;
  /** The query parameter it becomes. */
  readonly query: string;
  /** A timestamp is validated as one and sent as ISO-8601; text is sent as written. */
  readonly kind: 'timestamp' | 'text';
  /** Prepended to the value: GitHub's `created` filter takes `>=<date>`. */
  readonly prefix?: string;
}

/** The most pages one call reads, whatever the caller asks for. */
export const MAX_PAGES = 10;
/** Pages read when the caller names no bound. */
export const DEFAULT_PAGES = 5;
/** When GitHub says "slow down" with no reset time, the wait assumed before asking again. */
export const RATE_LIMIT_FALLBACK_MS = 60_000;

const repoPath = (owner: string, repo: string) =>
  `repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
const pullPath = (owner: string, repo: string, input: Record<string, unknown>, tail: string) =>
  `${repoPath(owner, repo)}/pulls/${encodeURIComponent(String(input['number']))}/${tail}`;

const OPERATIONS: Record<string, GitHubOperation> = {
  getRepository: {
    path: (_owner, repo) => `repos/${encodeURIComponent(_owner)}/${encodeURIComponent(repo)}`,
    method: 'GET',
    fields: [],
    bodyFields: [],
  },
  createIssue: {
    path: (owner, repo) => `repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues`,
    method: 'POST',
    fields: ['title'],
    bodyFields: ['title', 'body', 'labels'],
  },
  // The pull-request gate's two writes: a commit status, and one comment kept up to date.
  createCommitStatus: {
    path: (owner, repo, input) =>
      `repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/statuses/${encodeURIComponent(String(input['sha']))}`,
    method: 'POST',
    fields: ['sha', 'state'],
    bodyFields: ['state', 'target_url', 'description', 'context'],
  },
  listIssueComments: {
    path: (owner, repo, input) =>
      `repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${encodeURIComponent(String(input['number']))}/comments?per_page=100`,
    method: 'GET',
    fields: ['number'],
    bodyFields: [],
  },
  createIssueComment: {
    path: (owner, repo, input) =>
      `repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${encodeURIComponent(String(input['number']))}/comments`,
    method: 'POST',
    fields: ['number', 'body'],
    bodyFields: ['body'],
  },
  updateIssueComment: {
    path: (owner, repo, input) =>
      `repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/comments/${encodeURIComponent(String(input['commentId']))}`,
    method: 'PATCH',
    fields: ['commentId', 'body'],
    bodyFields: ['body'],
  },
  // ─── Delivery reads: paginated, never side-effecting ──────────────────────
  listPullRequests: {
    path: (owner, repo) => `${repoPath(owner, repo)}/pulls`,
    method: 'GET',
    fields: [],
    bodyFields: [],
    list: {
      query: { state: 'all', sort: 'updated', direction: 'desc' },
      orderedBy: 'updated_at',
    },
  },
  listPullRequestReviews: {
    path: (owner, repo, input) => pullPath(owner, repo, input, 'reviews'),
    method: 'GET',
    fields: ['number'],
    bodyFields: [],
    list: {},
  },
  listPullRequestCommits: {
    path: (owner, repo, input) => pullPath(owner, repo, input, 'commits'),
    method: 'GET',
    fields: ['number'],
    bodyFields: [],
    list: {},
  },
  listPullRequestFiles: {
    path: (owner, repo, input) => pullPath(owner, repo, input, 'files'),
    method: 'GET',
    fields: ['number'],
    bodyFields: [],
    list: {},
  },
  listCommits: {
    path: (owner, repo) => `${repoPath(owner, repo)}/commits`,
    method: 'GET',
    fields: [],
    bodyFields: [],
    list: {
      params: [
        { field: 'since', query: 'since', kind: 'timestamp' },
        { field: 'sha', query: 'sha', kind: 'text' },
      ],
    },
  },
  listDeployments: {
    path: (owner, repo) => `${repoPath(owner, repo)}/deployments`,
    method: 'GET',
    fields: [],
    bodyFields: [],
    list: {
      params: [
        { field: 'environment', query: 'environment', kind: 'text' },
        { field: 'sha', query: 'sha', kind: 'text' },
      ],
      orderedBy: 'created_at',
    },
  },
  listDeploymentStatuses: {
    path: (owner, repo, input) =>
      `${repoPath(owner, repo)}/deployments/${encodeURIComponent(String(input['deploymentId']))}/statuses`,
    method: 'GET',
    fields: ['deploymentId'],
    bodyFields: [],
    list: {},
  },
  listReleases: {
    path: (owner, repo) => `${repoPath(owner, repo)}/releases`,
    method: 'GET',
    fields: [],
    bodyFields: [],
    list: { orderedBy: 'created_at' },
  },
  listWorkflowRuns: {
    path: (owner, repo) => `${repoPath(owner, repo)}/actions/runs`,
    method: 'GET',
    fields: [],
    bodyFields: [],
    list: {
      // GitHub has no `since` here; its `created` filter takes a range, `>=` an open one.
      params: [
        { field: 'since', query: 'created', kind: 'timestamp', prefix: '>=' },
        { field: 'branch', query: 'branch', kind: 'text' },
        { field: 'status', query: 'status', kind: 'text' },
      ],
      itemsKey: 'workflow_runs',
      orderedBy: 'created_at',
    },
  },
};

export const githubAdapter: ConnectorAdapter = {
  manifest: {
    name: 'github',
    version: '1.0.0',
    operations: {
      getRepository: { sideEffecting: false, idempotent: true, timeoutMs: 10_000 },
      createIssue: { sideEffecting: true, idempotent: false, timeoutMs: 10_000 },
      // A status for one context on one commit replaces the previous one: repeating it is safe.
      createCommitStatus: { sideEffecting: true, idempotent: true, timeoutMs: 10_000 },
      listIssueComments: { sideEffecting: false, idempotent: true, timeoutMs: 10_000 },
      createIssueComment: { sideEffecting: true, idempotent: false, timeoutMs: 10_000 },
      updateIssueComment: { sideEffecting: true, idempotent: true, timeoutMs: 10_000 },
      // The delivery reads. The timeout is per page, as every attempt is one request.
      listPullRequests: { sideEffecting: false, idempotent: true, timeoutMs: 15_000 },
      listPullRequestReviews: { sideEffecting: false, idempotent: true, timeoutMs: 15_000 },
      listPullRequestCommits: { sideEffecting: false, idempotent: true, timeoutMs: 15_000 },
      listPullRequestFiles: { sideEffecting: false, idempotent: true, timeoutMs: 15_000 },
      listCommits: { sideEffecting: false, idempotent: true, timeoutMs: 15_000 },
      listDeployments: { sideEffecting: false, idempotent: true, timeoutMs: 15_000 },
      listDeploymentStatuses: { sideEffecting: false, idempotent: true, timeoutMs: 15_000 },
      listReleases: { sideEffecting: false, idempotent: true, timeoutMs: 15_000 },
      listWorkflowRuns: { sideEffecting: false, idempotent: true, timeoutMs: 15_000 },
    },
  },

  async execute(request: ConnectorRequest, secret: string): Promise<ConnectorResult> {
    try {
      // Every refusal happens before a request exists. A no-op request is not a GitHub
      // request, it is a rate-limit counter, so the empty secret is refused here rather
      // than becoming a 403 three calls later.
      if (secret.trim() === '') {
        throw new ConnectorInputError('invalid_input', 'a GitHub token is required');
      }
      const spec = operationSpecOf(request.operation);
      const operation = OPERATIONS[request.operation];
      const owner = requireString(request.input, 'owner');
      const repo = requireString(request.input, 'repo');
      const input = request.input as Record<string, unknown>;
      // Required fields first: some are path parameters, so the path is built after them.
      const body = requestBody(operation, input);
      const path = operation.path(owner, repo, input);

      if (operation.list !== undefined) {
        const read = await readList(
          listPlan(path, operation.list, input),
          secret,
          spec,
          request.signal,
        );
        return { status: 'ok', data: read.value, attempts: read.attempts };
      }

      const value = await executeWithRetry(
        async (signal) => {
          const response = await fetch(`${API}/${path}`, {
            ...requestInit(operation, secret, body),
            signal,
          });
          if (!response.ok) {
            // A 4xx is a statement about the *request* and nothing was created, so it is a
            // rejection: repeating it cannot duplicate anything. A 5xx is a statement
            // about the response only, and for a create that is the ambiguous case.
            const error =
              response.status >= 400 && response.status < 500
                ? new ConnectorRejectionError(response.status, 'GitHub request failed')
                : new ConnectorHttpError(response.status, 'GitHub request failed');
            throw error;
          }
          return response.json();
        },
        // From the manifest, which is where the operation's side-effecting claim lives.
        {
          retries: 2,
          signal: request.signal,
          idempotent: spec.idempotent,
          attemptTimeoutMs: spec.timeoutMs,
        },
      );

      return { status: 'ok', data: value.value, attempts: value.attempts };
    } catch (error) {
      if (error instanceof GitHubRateLimited) {
        return {
          status: 'error',
          error: {
            code: 'github_rate_limited',
            // Retryable at `retryAt`, not now: the dispatcher waits until then.
            retryable: true,
            message: 'GitHub rate limit reached',
            retryAt: error.retryAt.toISOString(),
          },
          attempts: error.attempts,
        };
      }
      if (error instanceof ConnectorInputError) {
        return {
          status: 'error',
          error: {
            code: `github_${error.code}`,
            retryable: false,
            // The refusal's own message. See the same note in `jira`: these are
            // authored here, and replacing them with a fixed phrase discards the
            // actionable half — which operation names are real, which field was blank.
            message: error.message,
          },
          attempts: 1,
        };
      }

      // No status at all: the remote never answered, so this is neither a rejection nor a
      // confirmed outcome. Distinct from a real 500, which is a server that said it is
      // unwell.
      const status = error instanceof ConnectorHttpError ? error.status : undefined;
      return {
        status: 'error',
        error: {
          // `github_<status>`, so "the repository is not there" stays distinguishable from
          // "your token cannot see it". Both were one prose string before.
          code: status === undefined ? 'github_transport_failed' : `github_${String(status)}`,
          // From the status, not from a literal. The old error called a 401 retryable.
          // A separate `TRANSIENT` set used to be unioned in here; it was a strict
          // subset of `isRetryableStatus`, so the `||` could never add anything, and
          // two places to update one policy is one too many.
          retryable: isRetryableStatus(status),
          message: 'GitHub operation failed',
        },
        attempts: attemptsOf(error),
      };
    }
  },
};

/** The manifest's claim for an operation, or a refusal naming what is declared. */
function operationSpecOf(operation: string): {
  sideEffecting: boolean;
  idempotent: boolean;
  timeoutMs: number;
} {
  const found = OPERATIONS[operation];
  if (found === undefined) {
    throw new ConnectorInputError(
      'unknown_operation',
      `github does not declare an operation named "${operation}"; it declares: ${Object.keys(
        githubAdapter.manifest.operations,
      )
        .sort()
        .join(', ')}`,
    );
  }
  return githubAdapter.manifest.operations[operation] as {
    sideEffecting: boolean;
    idempotent: boolean;
    timeoutMs: number;
  };
}

/**
 * An optional field, keeping arrays as arrays.
 *
 * The parameter is the already-validated input, not `unknown`. `execute` reads two
 * required strings before it gets here, so by the time this runs the container is
 * known to be an object — a `typeof input` guard here was a branch nothing could
 * reach, and a branch nothing can reach is either untested or tested by a
 * construction that cannot happen.
 */
function optionalField(input: Record<string, unknown>, field: string): unknown {
  const value = input[field];
  if (value === undefined || value === null) return undefined;
  // A blank string is treated as absent, not sent as `""`. GitHub accepts most
  // empty values, so forwarding one turns a field the caller left unset into a
  // field the caller actively set to nothing.
  if (typeof value === 'string' && value.trim() === '') return undefined;
  return value;
}

/**
 * The request body: every required field (refused when absent), then each optional body
 * field the caller sent. `requireString` on `owner` has already refused an input that is
 * not an object, which is what makes the caller's cast to a record true.
 */
function requestBody(
  operation: GitHubOperation,
  input: Record<string, unknown>,
): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const field of operation.fields) body[field] = requireString(input, field);
  for (const field of operation.bodyFields) {
    const value = optionalField(input, field);
    if (value !== undefined) body[field] = value;
  }
  return body;
}

/**
 * The body GitHub reads: only the declared body fields.
 *
 * The required fields are collected into `body` for validation, and some of them — `sha`,
 * `number`, `commentId` — are path parameters. Sending them as body keys is harmless to
 * GitHub but is a request the operation never declared.
 */
function bodyOf(
  operation: GitHubOperation,
  body: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(body).filter(([key]) => operation.bodyFields.includes(key)),
  );
}

/** The headers every request carries: GitHub's media type, the token, the API version. */
function githubHeaders(secret: string): Record<string, string> {
  return {
    accept: 'application/vnd.github+json',
    authorization: `Bearer ${secret}`,
    'x-github-api-version': '2022-11-28',
  };
}

/** The request for an operation: a GET carries no body and no content type. */
function requestInit(
  operation: GitHubOperation,
  secret: string,
  body: Record<string, unknown>,
): RequestInit {
  const headers = githubHeaders(secret);
  if (operation.method === 'GET') return { method: 'GET', headers };
  return {
    method: operation.method,
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify(bodyOf(operation, body)),
  };
}

// ─── Paginated reads ──────────────────────────────────────────────────────────

/**
 * GitHub said to slow down, and when it will answer again.
 *
 * Deliberately not a `ConnectorHttpError`: a 429 is a retryable status, and the retry
 * policy would spend its two retries 100 ms apart against a limit that resets in an hour.
 * Thrown as its own type, the policy stops at once and the caller is told the reset time,
 * which is the only useful thing to know about a rate limit.
 */
class GitHubRateLimited extends Error {
  attempts = 1;
  constructor(readonly retryAt: Date) {
    super('GitHub rate limit reached');
    this.name = 'GitHubRateLimited';
  }
}

/**
 * The reset time when a refusal is a rate limit, or `null` when it is not.
 *
 * GitHub answers a primary limit with 403 or 429 and `x-ratelimit-remaining: 0` beside
 * `x-ratelimit-reset` (epoch seconds), and a secondary limit with `retry-after` (seconds).
 * A 403 with neither is a permission refusal and stays one. A 429 with neither is still a
 * rate limit, and waits {@link RATE_LIMIT_FALLBACK_MS}.
 */
function rateLimitOf(response: Response, now: number): Date | null {
  if (response.status !== 403 && response.status !== 429) return null;
  const retryAfter = Number.parseInt(response.headers.get('retry-after') ?? '', 10);
  if (Number.isFinite(retryAfter)) return new Date(now + Math.max(0, retryAfter) * 1000);
  const reset = Number.parseInt(response.headers.get('x-ratelimit-reset') ?? '', 10);
  if (response.headers.get('x-ratelimit-remaining') === '0' && Number.isFinite(reset)) {
    return new Date(Math.max(now, reset * 1000));
  }
  return response.status === 429 ? new Date(now + RATE_LIMIT_FALLBACK_MS) : null;
}

/**
 * The `rel="next"` URL of a `Link` header, when it is GitHub's own.
 *
 * The header is the remote's to write, and the request it names carries the token. A next
 * link to any other origin is therefore not followed — the walk ends there — so a response
 * cannot send the credential somewhere the caller never named.
 */
function nextLink(response: Response): string | null {
  const header = response.headers.get('link');
  if (header === null) return null;
  for (const part of header.split(',')) {
    const match = /^\s*<([^>]+)>\s*;\s*rel="next"\s*$/u.exec(part);
    if (match !== null) {
      const url = match[1] as string;
      return url.startsWith(`${API}/`) ? url : null;
    }
  }
  return null;
}

function pageOf(url: string): number | null {
  const page = Number.parseInt(new URL(url).searchParams.get('page') ?? '', 10);
  return Number.isFinite(page) ? page : null;
}

/** An optional whole number in `[min, max]`, from a number or a numeric string. */
function boundedInteger(
  input: Record<string, unknown>,
  field: string,
  min: number,
  max: number,
  fallback: number,
): number {
  const raw = input[field];
  if (raw === undefined) return fallback;
  const value = typeof raw === 'number' || typeof raw === 'string' ? Number(raw) : Number.NaN;
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new ConnectorInputError(
      'invalid_input',
      `input.${field} must be a whole number from ${String(min)} to ${String(max)}`,
    );
  }
  return value;
}

/** An optional timestamp, as the instant it names. */
function optionalInstant(input: Record<string, unknown>, field: string): Date | undefined {
  const raw = input[field];
  if (raw === undefined) return undefined;
  const at = Date.parse(typeof raw === 'string' ? raw : '');
  if (!Number.isFinite(at)) {
    throw new ConnectorInputError('invalid_input', `input.${field} must be an ISO-8601 timestamp`);
  }
  return new Date(at);
}

interface ListPlan {
  url: string;
  maxPages: number;
  /** Items older than `at` by `field` are dropped, and the walk ends at the first one. */
  cutoff: { field: string; at: Date } | null;
  itemsKey: string | undefined;
}

/** The first URL of a list and how far to walk it, every input refused before a request. */
function listPlan(path: string, list: GitHubList, input: Record<string, unknown>): ListPlan {
  const query = new URLSearchParams({
    ...list.query,
    per_page: String(boundedInteger(input, 'perPage', 1, 100, 100)),
    page: String(boundedInteger(input, 'page', 1, 100_000, 1)),
  });
  for (const param of list.params ?? []) {
    if (param.kind === 'timestamp') {
      const at = optionalInstant(input, param.field);
      if (at !== undefined) query.set(param.query, `${param.prefix ?? ''}${at.toISOString()}`);
    } else {
      // `requireString`'s rules for an optional field: present means a non-blank string.
      if (input[param.field] !== undefined) {
        query.set(param.query, requireString(input, param.field));
      }
    }
  }
  const newerThan = list.orderedBy === undefined ? undefined : optionalInstant(input, 'newerThan');
  return {
    url: `${API}/${path}?${query.toString()}`,
    maxPages: boundedInteger(input, 'maxPages', 1, MAX_PAGES, DEFAULT_PAGES),
    cutoff: newerThan === undefined ? null : { field: list.orderedBy as string, at: newerThan },
    itemsKey: list.itemsKey,
  };
}

function itemsOf(body: unknown, key: string | undefined): unknown[] {
  const container = key === undefined ? body : (Object(body) as Record<string, unknown>)[key];
  return Array.isArray(container) ? container : [];
}

function isOlder(item: unknown, cutoff: { field: string; at: Date }): boolean {
  const at = Date.parse(String((Object(item) as Record<string, unknown>)[cutoff.field]));
  return at < cutoff.at.getTime();
}

/**
 * Walks a list from its first URL along `rel="next"`, at most `maxPages` pages.
 *
 * Each page is one retried request, under the same policy as every other read: a 5xx is
 * retried, a 4xx is not, and a rate limit stops the walk with its reset time. A failure on
 * page three fails the call — there is no partial answer — and its attempt count includes
 * the pages before it, so the count is every request this call made.
 */
async function readList(
  plan: ListPlan,
  secret: string,
  spec: { idempotent: boolean; timeoutMs: number },
  signal: AbortSignal | undefined,
): Promise<{
  value: { items: unknown[]; pages: number; nextPage: number | null };
  attempts: number;
}> {
  const items: unknown[] = [];
  let cursor: string | null = plan.url;
  let pages = 0;
  let attempts = 0;
  let nextPage: number | null = null;
  while (cursor !== null) {
    if (pages >= plan.maxPages) {
      nextPage = pageOf(cursor);
      break;
    }
    const url: string = cursor;
    let page: { value: { body: unknown; next: string | null }; attempts: number };
    try {
      page = await executeWithRetry(
        async (attemptSignal) => {
          const response = await fetch(url, {
            method: 'GET',
            headers: githubHeaders(secret),
            signal: attemptSignal,
          });
          if (!response.ok) {
            const retryAt = rateLimitOf(response, Date.now());
            if (retryAt !== null) throw new GitHubRateLimited(retryAt);
            throw response.status < 500
              ? new ConnectorRejectionError(response.status, 'GitHub request failed')
              : new ConnectorHttpError(response.status, 'GitHub request failed');
          }
          return { body: (await response.json()) as unknown, next: nextLink(response) };
        },
        { retries: 2, signal, idempotent: spec.idempotent, attemptTimeoutMs: spec.timeoutMs },
      );
    } catch (error) {
      if (error instanceof ConnectorHttpError || error instanceof GitHubRateLimited) {
        error.attempts += attempts;
      }
      throw error;
    }
    attempts += page.attempts;
    pages += 1;
    const all = itemsOf(page.value.body, plan.itemsKey);
    const { cutoff } = plan;
    const kept = cutoff === null ? all : all.filter((item) => !isOlder(item, cutoff));
    items.push(...kept);
    // Ordered newest first: a page that reached an older item is the last one worth reading.
    cursor = kept.length < all.length ? null : page.value.next;
  }
  return { value: { items, pages, nextPage }, attempts };
}
