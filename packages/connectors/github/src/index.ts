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
  /** Path template below `/repos/{owner}/{repo}`, or `null` for a path of its own. */
  readonly path: (owner: string, repo: string) => string;
  readonly method: 'GET' | 'POST';
  /** Required input fields beyond `owner` and `repo`. */
  readonly fields: readonly string[];
  /** Fields sent in the body, when there is a body. */
  readonly bodyFields: readonly string[];
}

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
};

export const githubAdapter: ConnectorAdapter = {
  manifest: {
    name: 'github',
    version: '1.0.0',
    operations: {
      getRepository: { sideEffecting: false, idempotent: true, timeoutMs: 10_000 },
      createIssue: { sideEffecting: true, idempotent: false, timeoutMs: 10_000 },
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
      const path = operation.path(owner, repo);

      const body: Record<string, unknown> = {};
      for (const field of operation.fields) body[field] = requireString(request.input, field);
      // `requireString` above has already refused anything that is not a non-null
      // object — it throws `input must be an object` otherwise — so by here the
      // container is known. The narrowing is a cast rather than a re-check because a
      // re-check is a branch nothing can reach, and the branch before it is the
      // thing that makes the cast true.
      const input = request.input as Record<string, unknown>;
      for (const field of operation.bodyFields) {
        const value = optionalField(input, field);
        if (value !== undefined) body[field] = value;
      }

      const value = await executeWithRetry(
        async () => {
          const response = await fetch(`${API}/${path}`, {
            method: operation.method,
            headers: {
              accept: 'application/vnd.github+json',
              authorization: `Bearer ${secret}`,
              'x-github-api-version': '2022-11-28',
              ...(operation.method === 'POST' ? { 'content-type': 'application/json' } : {}),
            },
            ...(operation.method === 'POST' ? { body: JSON.stringify(body) } : {}),
            signal: request.signal,
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
        { retries: 2, signal: request.signal, idempotent: spec.idempotent },
      );

      return { status: 'ok', data: value.value, attempts: value.attempts };
    } catch (error) {
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
