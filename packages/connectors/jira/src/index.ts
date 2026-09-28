import {
  attemptsOf,
  ConnectorHttpError,
  ConnectorInputError,
  ConnectorRejectionError,
  executeWithRetry,
  isRetryableStatus,
  operationSpec,
  requireString,
  type ConnectorAdapter,
  type ConnectorRequest,
  type ConnectorResult,
} from '@automate/connectors-sdk';

/**
 * The Jira Cloud REST API, v3.
 *
 * The defect this row is about is one line of it: the host was a literal,
 * `https://your-domain.atlassian.net`, so every install of this connector — however it was
 * configured, and whatever the caller asked for — talked to the same URL, and the test
 * asserted that URL as correct. A tenant is *configuration*, so it comes from the caller,
 * in `input.baseUrl`, and is refused rather than defaulted: a default here is the defect
 * made reusable.
 *
 * **The base URL is refused unless it is `https`.** It becomes the prefix of every request
 * and the requests carry a bearer token, so an `http:` one sends that token in clear text.
 * This is the same rule `apps/api/src/config.ts` applies to the object store endpoint, for
 * the same reason, and it is refused here rather than at the boundary because the boundary
 * cannot see a string that has not become a request yet.
 *
 * The dispatch table is held separately from the manifest and cross-checked against it by a
 * test. A manifest entry with no dispatch entry is an operation a caller can read about and
 * cannot call, and that is exactly the shape of the defect this row describes.
 *
 * **An issue key goes into a URL, so it is percent-encoded.** Unencoded,
 * `ACME-1/../../myself` reaches a different endpoint and still answers 200 — a read the
 * caller believes and never made.
 */

const API = '/rest/api/3';

interface JiraOperation {
  /** Path below the API root, with the caller's fields already interpolated and encoded. */
  readonly path: (fields: Record<string, string>) => string;
  readonly method: 'GET' | 'POST';
  /** Input fields the path needs, and the ones the body carries. */
  readonly required: readonly string[];
  /** The body, when the operation has one. */
  readonly body?: (fields: Record<string, string>, input: unknown) => unknown;
}

const OPERATIONS: Record<string, JiraOperation> = {
  authTest: { path: () => '/myself', method: 'GET', required: [] },
  getIssue: {
    // No nullish fallback: `required: ['issueKey']` means `gatherFields` fills it
    // through `requireString`, which throws rather than omit it, so an absent key
    // here cannot be reached — and the type says so too. A `?? ''` fallback would
    // turn a programming error into a request for issue key `""`.
    path: (f) => `/issue/${encodeURIComponent(f['issueKey'])}`,
    method: 'GET',
    required: ['issueKey'],
  },
  createIssue: {
    path: () => '/issue',
    method: 'POST',
    required: ['projectKey', 'summary'],
    body: (f) => ({
      fields: {
        project: { key: f['projectKey'] },
        issuetype: { name: f['issueType'] ?? 'Task' },
        summary: f['summary'],
        ...(optionalString(f, 'description') === undefined
          ? {}
          : { description: optionalString(f, 'description') }),
      },
    }),
  },
};

/** A field from an already-validated set. */
function optionalString(fields: Record<string, string>, field: string): string | undefined {
  return fields[field];
}

/**
 * The tenant, validated.
 *
 * Refused rather than defaulted for every failure, including a missing one: the whole
 * defect was a default, and a default that is "empty string" would still produce a request
 * to a host nobody chose.
 */
function requireBaseUrl(input: unknown): string {
  const raw = requireString(input, 'baseUrl');
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new ConnectorInputError('invalid_input', 'input.baseUrl must be an absolute URL');
  }
  if (parsed.protocol !== 'https:') {
    throw new ConnectorInputError(
      'invalid_input',
      'input.baseUrl must use https: the bearer token would cross the network in clear text',
    );
  }
  return raw.replace(/\/+$/, '');
}

export const jiraAdapter: ConnectorAdapter = {
  manifest: {
    name: 'jira',
    version: '1.0.0',
    operations: {
      authTest: { sideEffecting: false, idempotent: true, timeoutMs: 10_000 },
      getIssue: { sideEffecting: false, idempotent: true, timeoutMs: 10_000 },
      createIssue: { sideEffecting: true, idempotent: false, timeoutMs: 10_000 },
    },
  },

  async execute(request: ConnectorRequest, secret: string): Promise<ConnectorResult> {
    try {
      // Every refusal happens before a request exists. The old adapter sent a request for
      // all of these and reported `status: 'ok'` for the first two.
      const { operation, idempotent } = dispatchFor(request.operation);
      const base = requireBaseUrl(request.input);
      // `requireBaseUrl` has already refused anything that is not a non-null object —
      // it throws `input must be an absolute URL` or `input must be an object`
      // otherwise — so the container is known here. The narrowing is a cast rather
      // than a re-check because a re-check is a branch nothing can reach, and the
      // branch before it is what makes the cast true.
      const input = request.input as Record<string, unknown>;
      const fields = gatherFields(operation, input);
      const body = operation.body?.(fields, input);
      const url = `${base}${API}${operation.path(fields)}`;

      const value = await executeWithRetry(
        async () => {
          const response = await fetch(url, {
            method: operation.method,
            headers: {
              accept: 'application/json',
              authorization: `Bearer ${secret}`,
              ...(body === undefined ? {} : { 'content-type': 'application/json' }),
            },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            signal: request.signal,
          });
          if (!response.ok) {
            // A 4xx is a statement about the *request* and nothing was created; a 5xx is a
            // statement about the response only, and for a create that is the ambiguous
            // case finding P-13 is about.
            throw response.status >= 400 && response.status < 500
              ? new ConnectorRejectionError(response.status, 'Jira request failed')
              : new ConnectorHttpError(response.status, 'Jira request failed');
          }
          return response.json();
        },
        { retries: 2, signal: request.signal, idempotent },
      );

      return { status: 'ok', data: value.value, attempts: value.attempts };
    } catch (error) {
      return failure(error);
    }
  },
};

/**
 * The request for an operation, and the manifest's claim about it.
 *
 * One authority and one refusal, which is the shape `slack` and `github` already
 * have. This used to ask the question twice — once of the dispatch table, once of the
 * manifest — because the two were consulted separately: the table said which request
 * to make, and a second helper returned `idempotent`. The manifest is what a caller
 * reads to decide what is available and what is safe to repeat, so it is the thing
 * to ask, and `operationSpec` already refuses an operation it does not declare while
 * naming the spellings that do exist.
 *
 * `OPERATIONS` is keyed identically, and `connector-dispatch.test.ts` asserts across
 * all three connectors that every declared operation has an entry and every entry is
 * declared. So the table lookup below is safe by a *tested* invariant rather than by
 * a second runtime check that could only ever repeat the first one — and a check
 * that can never disagree with the check beside it is not a second opinion.
 *
 * @throws {ConnectorInputError} `unknown_operation`
 */
function dispatchFor(operation: string): { operation: JiraOperation; idempotent: boolean } {
  const spec = operationSpec(jiraAdapter.manifest, operation);
  return { operation: OPERATIONS[operation], idempotent: spec.idempotent };
}

/**
 * The validated input fields an operation's path and body read.
 *
 * The required ones are refused by {@link requireString} if absent, so nothing
 * downstream has to re-check them — which is also why there is no `typeof input`
 * guard here. `requireBaseUrl` has already thrown unless the input is a non-null
 * object, so re-testing it is a branch nothing can reach, and an unreachable branch
 * is either untested or tested by a construction that cannot happen.
 *
 * The two optional ones — `issueType` and `description` — are copied only when they
 * are non-blank strings, so a caller passing `issueType: ""` gets Jira's default
 * task type rather than a body with an empty string where a name belongs.
 */
function gatherFields(
  operation: JiraOperation,
  input: Record<string, unknown>,
): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const field of operation.required) fields[field] = requireString(input, field);
  const record = input;
  for (const field of ['issueType', 'description']) {
    const value = record[field];
    if (typeof value === 'string' && value.trim() !== '') fields[field] = value;
  }
  return fields;
}

/**
 * A failure, as a result.
 *
 * Two of the three shapes here are "you asked for something this adapter cannot do", and
 * repeating that verbatim will not change the answer, so `retryable` is false for both. The
 * old error said `retryable: true` on everything, so a missing tenant spent the caller's
 * whole budget learning what one refusal said immediately.
 *
 * The third — no status at all — is the remote never answering. That is neither a rejection
 * nor a confirmed outcome, it is distinct from a real 500 (a server that said it is unwell),
 * and it is **not** retryable by this policy: nothing came back, so nothing says the
 * request was refused, and repeating a non-idempotent create is how one caller becomes two
 * issues. The caller's own budget decides whether to try again.
 */
function failure(error: unknown): ConnectorResult {
  if (error instanceof ConnectorInputError) {
    return {
      status: 'error',
      error: {
        code: `jira_${error.code}`,
        retryable: false,
        // The refusal's own message, not a generic one. Every message in this
        // branch is written by this adapter or by the shared `operationSpec`, and both
        // exist to be acted on: a caller who guessed an operation name needs the
        // spellings that do exist, and a caller who sent a blank tenant needs to know
        // which field was blank. Replacing it with a fixed phrase throws that away at
        // the last hop, so the effort `operationSpec` spends naming the real
        // operations never reaches the caller.
        message: error.message,
      },
      attempts: 1,
    };
  }

  const status = error instanceof ConnectorHttpError ? error.status : undefined;
  return {
    status: 'error',
    error: {
      // `jira_<status>`, so "the issue is not there" stays distinguishable from "your
      // token cannot see it". Both were one prose string before.
      code: status === undefined ? 'jira_transport_failed' : `jira_${String(status)}`,
      // From the status, not from a literal: the old error called a 400 retryable.
      // `isRetryableStatus` answers `false` for an absent status, so a remote that never
      // answered is not retried without this adapter having to know that separately.
      retryable: isRetryableStatus(status),
      message: 'Jira operation failed',
    },
    attempts: attemptsOf(error),
  };
}
