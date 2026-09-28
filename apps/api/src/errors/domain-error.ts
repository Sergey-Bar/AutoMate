/**
 * The error taxonomy for the API boundary.
 *
 * Two problems this exists to solve:
 *
 *  1. A Postgres CHECK, unique-index, or FK violation carried no classification
 *     at all, so it reached the client as a bare 500. A caller who sent a state
 *     transition the database rejects could not tell "your request is wrong"
 *     from "the server is broken" — so they retried, and a client error became
 *     load.
 *  2. 19 places catch a third-party error and drop the original entirely, so a
 *     Drizzle or `pg` failure surfaced as a message with no type, no code, and
 *     nothing a caller could branch on.
 *
 * Every error crossing the HTTP boundary is a `DomainError` with a stable
 * `code` and a mapped status. Anything unrecognised becomes an `INTERNAL`
 * DomainError whose `cause` keeps the original for the log while the response
 * carries only the code and the request id — never a stack, a SQL fragment or a
 * column name.
 */

/** Every code the API can return. Stable: callers branch on these. */
export const ErrorCode = {
  // 400 — the request itself is malformed.
  INVALID_REQUEST: 'INVALID_REQUEST',
  INVALID_JSON: 'INVALID_JSON',
  INVALID_REQUEST_BODY: 'INVALID_REQUEST_BODY',
  MISSING_REQUIRED_FIELD: 'MISSING_REQUIRED_FIELD',

  /**
   * The execution and control-plane request bodies, by name.
   *
   * Every one of these used to be a string literal at the call site, paired with a
   * status literal beside it: `error(c, 400, 'INVALID_ARTIFACT', …)`, where the
   * `error` helper accepted any `string` for the code and any of nine statuses. So
   * there was no check on either half — a code the taxonomy had never heard of
   * compiled, and a status that contradicted the code compiled, and every test passed,
   * because the tests asserted the shape and none asserted the mapping.
   *
   * **The disagreement is not hypothetical and it is not about two hand-typed
   * literals.** Two of the forty-two sites never typed a status at all: one passed
   * `decoded.status` and one passed `409` beside a code it had read from elsewhere, so
   * the status was decided in a second place for those two while the other forty
   * decided it in the first. That is the arrangement, and it is what this table
   * removes.
   */
  INVALID_RUN: 'INVALID_RUN',
  INVALID_CLAIM: 'INVALID_CLAIM',
  INVALID_CURSOR: 'INVALID_CURSOR',
  INVALID_ARTIFACT: 'INVALID_ARTIFACT',
  INVALID_COMPLETION: 'INVALID_COMPLETION',
  INVALID_EVENT_BATCH: 'INVALID_EVENT_BATCH',
  INVALID_HEARTBEAT: 'INVALID_HEARTBEAT',
  INVALID_JOB_ID: 'INVALID_JOB_ID',
  INVALID_POLICY: 'INVALID_POLICY',
  INVALID_RUNNER_MANIFEST: 'INVALID_RUNNER_MANIFEST',
  IDEMPOTENCY_KEY_REQUIRED: 'IDEMPOTENCY_KEY_REQUIRED',
  ARTIFACT_CHECKSUM_MISMATCH: 'ARTIFACT_CHECKSUM_MISMATCH',
  ARTIFACT_SIZE_MISMATCH: 'ARTIFACT_SIZE_MISMATCH',
  /**
   * The two answers the base64 gate in `http/artifact-bytes.ts` can give, named here
   * rather than in that module's own return type.
   *
   * `ArtifactBytesRejection` carried `status: 400 | 413` and a `code` union beside it —
   * the same pair the execution routes restated everywhere else, in a third place. The
   * codes live here now, so `ArtifactBytesRejection.code` is an `ErrorCodeValue` and the
   * status is read from this table rather than carried beside the code.
   */
  INVALID_ARTIFACT_BYTES: 'INVALID_ARTIFACT_BYTES',
  ARTIFACT_TOO_LARGE: 'ARTIFACT_TOO_LARGE',
  INVALID_LOGIN_REQUEST: 'INVALID_LOGIN_REQUEST',
  INVALID_AUTOMATION_DEFINITION: 'INVALID_AUTOMATION_DEFINITION',
  INVALID_SCHEDULE: 'INVALID_SCHEDULE',
  INVALID_ENROLLMENT_REQUEST: 'INVALID_ENROLLMENT_REQUEST',
  INVALID_REPORTER_UPLOAD: 'INVALID_REPORTER_UPLOAD',
  INVALID_LEGACY_REPORTER_EVENT: 'INVALID_LEGACY_REPORTER_EVENT',
  INVALID_VERSIONED_REPORTER_EVENT: 'INVALID_VERSIONED_REPORTER_EVENT',
  INVALID_QUALITY_GATE: 'INVALID_QUALITY_GATE',
  INVALID_QUARANTINE_ENTRY: 'INVALID_QUARANTINE_ENTRY',
  INVALID_QUARANTINE_DECISION: 'INVALID_QUARANTINE_DECISION',

  // 401 / 403 — authentication and authorisation.
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  RUNNER_UNAUTHORIZED: 'RUNNER_UNAUTHORIZED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  INVALID_ENROLLMENT_TOKEN: 'INVALID_ENROLLMENT_TOKEN',
  INVALID_REPORTER_TOKEN: 'INVALID_REPORTER_TOKEN',
  MISSING_REPORTER_TOKEN: 'MISSING_REPORTER_TOKEN',
  /**
   * Distinct from `RUNNER_UNAUTHORIZED`, which is a runner whose *token* does not
   * authenticate. These two answer about the act of enrolling and about a credential
   * rotation, and a runner operator reads them differently: one means "register
   * again", the other means "the registration secret is wrong".
   */
  RUNNER_REGISTRATION_UNAUTHORIZED: 'RUNNER_REGISTRATION_UNAUTHORIZED',
  RUNNER_ROTATION_UNAUTHORIZED: 'RUNNER_ROTATION_UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',

  // 404 — addressed something that does not exist, or must not be visible.
  NOT_FOUND: 'NOT_FOUND',
  RUN_NOT_FOUND: 'RUN_NOT_FOUND',
  JOB_NOT_FOUND: 'JOB_NOT_FOUND',
  ARTIFACT_NOT_FOUND: 'ARTIFACT_NOT_FOUND',
  ARTIFACT_UNREADABLE: 'ARTIFACT_UNREADABLE',
  POLICY_NOT_FOUND: 'POLICY_NOT_FOUND',
  RUNNER_NOT_FOUND: 'RUNNER_NOT_FOUND',
  AUTOMATION_NOT_FOUND: 'AUTOMATION_NOT_FOUND',
  QUALITY_GATE_NOT_FOUND: 'QUALITY_GATE_NOT_FOUND',
  QUARANTINE_ENTRY_NOT_FOUND: 'QUARANTINE_ENTRY_NOT_FOUND',

  // 409 — the request is well-formed but conflicts with current state.
  CONFLICT: 'CONFLICT',
  RUN_ALREADY_EXISTS: 'RUN_ALREADY_EXISTS',
  IDEMPOTENCY_KEY_REUSED: 'IDEMPOTENCY_KEY_REUSED',
  STALE_LEASE: 'STALE_LEASE',
  STALE_FENCING_TOKEN: 'STALE_FENCING_TOKEN',
  LEASE_NOT_OWNED: 'LEASE_NOT_OWNED',
  LEASE_REQUIRED: 'LEASE_REQUIRED',
  INVALID_STATE_TRANSITION: 'INVALID_STATE_TRANSITION',
  SERIALIZATION_FAILED: 'SERIALIZATION_FAILED',
  DUPLICATE: 'DUPLICATE',
  /**
   * The four lease failures, as four codes rather than one.
   *
   * They are separate because a runner's next action differs for each: a missing lease
   * is a bug in the runner, a lease it does not own is a lost job, an invalid lease id
   * is a re-claim, and a stale fencing token means somebody else was given the job
   * while this worker was still running. `STALE_LEASE` and `STALE_FENCING_TOKEN` above
   * are the same pair as `JOB_LEASE_INVALID` and `JOB_FENCING_STALE`; the execution
   * routes answer in their own names because the runner client reads those, and
   * collapsing the two sets would throw the distinction away — which is what this
   * migration had to preserve rather than tidy.
   */
  JOB_LEASE_REQUIRED: 'JOB_LEASE_REQUIRED',
  JOB_LEASE_NOT_OWNED: 'JOB_LEASE_NOT_OWNED',
  JOB_LEASE_INVALID: 'JOB_LEASE_INVALID',
  JOB_FENCING_STALE: 'JOB_FENCING_STALE',
  RUN_NOT_RETRYABLE: 'RUN_NOT_RETRYABLE',
  STALE_OR_CONFLICTING_EVENT: 'STALE_OR_CONFLICTING_EVENT',
  RUNNER_ID_TAKEN: 'RUNNER_ID_TAKEN',
  /**
   * A run that existed and does not.
   *
   * Distinct from `RUN_NOT_FOUND`, which is a run that never existed, and the two need
   * different client behaviour: a vanished run means resynchronise — the cursor being
   * held refers to evidence the retention sweep has taken — while a run that was never
   * there means stop asking. The body used to say `code: 'RUN_VANISHED'` beside a prose
   * `error`, which is this distinction expressed in the one place nobody reads.
   */
  RUN_VANISHED: 'RUN_VANISHED',
  /** A status outside the persisted vocabulary, with the allowed set in `details`. */
  INVALID_RUN_STATUS: 'INVALID_RUN_STATUS',
  /**
   * A run that has concluded cannot be moved. 409, not 400: the request was well formed
   * and the run exists, and its current state forbids the change. The message used to
   * build the two statuses into a sentence, so the caller had to read it to learn which
   * states it could have asked for; `details` now says so in fields.
   */
  RUN_STATUS_TERMINAL: 'RUN_STATUS_TERMINAL',

  // 413 — too large.
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',

  // 422 — well-formed, but violates a domain invariant the database enforces.
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  EVIDENCE_INCOMPLETE: 'EVIDENCE_INCOMPLETE',
  CHECK_CONSTRAINT_VIOLATED: 'CHECK_CONSTRAINT_VIOLATED',

  // 429 — the caller is sending too fast. Distinct from 503 on purpose: a 503 says
  // *this server* is unwell and invites a retry elsewhere, while a rate limit says the
  // caller's own rate is the problem and that retrying sooner makes it worse.
  LOGIN_RATE_LIMITED: 'LOGIN_RATE_LIMITED',

  // 503 — a dependency is unavailable.
  DEPENDENCY_UNAVAILABLE: 'DEPENDENCY_UNAVAILABLE',
  NOT_CONFIGURED: 'NOT_CONFIGURED',
  /**
   * The request exceeded the server-side deadline. Distinct from
   * `DEPENDENCY_UNAVAILABLE` for the same reason `RUN_SERIALIZATION_FAILED` is
   * distinct from `INTERNAL`: a slow operation is a capacity signal, and alerting
   * on it as a generic 503 hides which one grew.
   */
  REQUEST_TIMEOUT: 'REQUEST_TIMEOUT',
  /**
   * Artifact bytes could not be stored or fetched. 503 rather than 500 because the
   * write itself is the product working and the storage tier is not, and a 500 puts
   * an infrastructure outage into the application-defect count.
   */
  ARTIFACT_STORAGE_FAILED: 'ARTIFACT_STORAGE_FAILED',
  /**
   * The row exists and its bytes could not be read. 503 rather than 404 on purpose,
   * and the distinction is the whole point: 404 says the evidence never existed, which
   * tells the caller to stop asking and tells nobody to go and look. A storage fault
   * reported as a missing artifact is how a passing run keeps passing while its
   * evidence quietly disappears.
   */
  ARTIFACT_BYTES_UNAVAILABLE: 'ARTIFACT_BYTES_UNAVAILABLE',

  // 500 — a defect. The response says nothing about the cause.
  INTERNAL: 'INTERNAL',
  /**
   * A row or artifact that the canonical schema rejected. A 500, because it means our
   * own projection disagrees with our own contract — but a distinct code, so it can be
   * alerted on separately and the offending field identified from the log rather than
   * from a generic failure count.
   */
  RUN_SERIALIZATION_FAILED: 'RUN_SERIALIZATION_FAILED',
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

/**
 * Every code, and the status it answers with, in one table.
 *
 * `Record<ErrorCodeValue, number>` is the enforcement: add a code to `ErrorCode` and
 * this stops compiling until it has a status, so a code with no status cannot reach a
 * response as an unclassified failure. Before finding C-3 the 42 execution call sites
 * each carried the pair themselves, which is 42 chances to write a 404 where the code
 * means a 400 — and nothing would have noticed, because every test asserted the shape
 * and none asserted the mapping.
 */
const STATUS_BY_CODE: Record<ErrorCodeValue, number> = {
  INVALID_REQUEST: 400,
  INVALID_JSON: 400,
  INVALID_REQUEST_BODY: 400,
  MISSING_REQUIRED_FIELD: 400,
  INVALID_RUN: 400,
  INVALID_CLAIM: 400,
  INVALID_CURSOR: 400,
  INVALID_ARTIFACT: 400,
  INVALID_COMPLETION: 400,
  INVALID_EVENT_BATCH: 400,
  INVALID_HEARTBEAT: 400,
  INVALID_JOB_ID: 400,
  INVALID_POLICY: 400,
  INVALID_RUNNER_MANIFEST: 400,
  IDEMPOTENCY_KEY_REQUIRED: 400,
  ARTIFACT_CHECKSUM_MISMATCH: 400,
  ARTIFACT_SIZE_MISMATCH: 400,
  INVALID_ARTIFACT_BYTES: 400,
  INVALID_LOGIN_REQUEST: 400,
  INVALID_AUTOMATION_DEFINITION: 400,
  INVALID_SCHEDULE: 400,
  INVALID_ENROLLMENT_REQUEST: 400,
  INVALID_REPORTER_UPLOAD: 400,
  INVALID_LEGACY_REPORTER_EVENT: 400,
  INVALID_VERSIONED_REPORTER_EVENT: 400,
  INVALID_QUALITY_GATE: 400,
  INVALID_QUARANTINE_ENTRY: 400,
  INVALID_QUARANTINE_DECISION: 400,
  INVALID_RUN_STATUS: 400,
  UNAUTHENTICATED: 401,
  RUNNER_UNAUTHORIZED: 401,
  INVALID_CREDENTIALS: 401,
  INVALID_ENROLLMENT_TOKEN: 401,
  MISSING_REPORTER_TOKEN: 401,
  RUNNER_REGISTRATION_UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  RUNNER_ROTATION_UNAUTHORIZED: 403,
  INVALID_REPORTER_TOKEN: 403,
  NOT_FOUND: 404,
  RUN_NOT_FOUND: 404,
  JOB_NOT_FOUND: 404,
  ARTIFACT_NOT_FOUND: 404,
  ARTIFACT_UNREADABLE: 404,
  POLICY_NOT_FOUND: 404,
  RUNNER_NOT_FOUND: 404,
  AUTOMATION_NOT_FOUND: 404,
  QUALITY_GATE_NOT_FOUND: 404,
  QUARANTINE_ENTRY_NOT_FOUND: 404,
  CONFLICT: 409,
  RUN_ALREADY_EXISTS: 409,
  IDEMPOTENCY_KEY_REUSED: 409,
  STALE_LEASE: 409,
  STALE_FENCING_TOKEN: 409,
  LEASE_NOT_OWNED: 409,
  LEASE_REQUIRED: 409,
  INVALID_STATE_TRANSITION: 409,
  SERIALIZATION_FAILED: 409,
  DUPLICATE: 409,
  JOB_LEASE_REQUIRED: 409,
  JOB_LEASE_NOT_OWNED: 409,
  JOB_LEASE_INVALID: 409,
  JOB_FENCING_STALE: 409,
  RUN_NOT_RETRYABLE: 409,
  STALE_OR_CONFLICTING_EVENT: 409,
  RUNNER_ID_TAKEN: 409,
  RUN_VANISHED: 409,
  RUN_STATUS_TERMINAL: 409,
  PAYLOAD_TOO_LARGE: 413,
  ARTIFACT_TOO_LARGE: 413,
  VALIDATION_FAILED: 422,
  EVIDENCE_INCOMPLETE: 422,
  CHECK_CONSTRAINT_VIOLATED: 422,
  LOGIN_RATE_LIMITED: 429,
  DEPENDENCY_UNAVAILABLE: 503,
  NOT_CONFIGURED: 503,
  REQUEST_TIMEOUT: 503,
  ARTIFACT_STORAGE_FAILED: 503,
  ARTIFACT_BYTES_UNAVAILABLE: 503,
  INTERNAL: 500,
  RUN_SERIALIZATION_FAILED: 500,
};

export interface DomainErrorOptions {
  status?: number;
  /** Safe to return to the caller. Never include a value, token or path. */
  details?: Record<string, unknown>;
  /**
   * Keep the message and `details` in the response on a 5xx.
   *
   * The boundary replaces the message and drops the details on every 5xx, because a
   * server fault must not describe itself. That rule is right and it is not absolute: some 5xx answers are *about a
   * resource the caller named*, and the details are the answer rather than a disclosure.
   *
   * `ARTIFACT_BYTES_UNAVAILABLE` and `NOT_CONFIGURED` are the cases that forced this. It answers 503 because
   * the storage tier is unwell, and it carries the artifact id, run id and expected
   * checksum — every one of which the caller supplied or already knew. Without this flag
   * the boundary returns `{ code, message: 'internal error', details: {} }` and the
   * caller learns only that *something* is wrong, having just asked about a specific
   * artifact; a support conversation starts by re-deriving what the request already
   * said. And `NOT_CONFIGURED` answers 503 with "Authentication is not configured", which
   * an operator can act on and "internal error" cannot — a deployment missing its API
   * key is not a defect, it is a checklist item, and the boundary was filing it as a
   * crash while telling the person who has to fix it nothing.
   *
   * **This is for a caller's own resources and nothing else.** An internal table name,
   * a constraint, a path, a host, or a stack must never travel with this flag, and the
   * log-only channel (`logDetail`) is still the only route for those.
   */
  callerSafe?: boolean;
  /**
   * Extra context for the log only, never in the response. Used for the pieces
   * that identify an internal object — a constraint name, a table — which help
   * whoever reads the log and tell a caller more about the schema than they need.
   */
  logDetail?: string;
  cause?: unknown;
}

/**
 * An error with a stable code and a mapped status.
 *
 * `message` is what a caller sees and is written to be safe for them.
 * `logDetail`, when present, is appended to the server log and never returned.
 */
export class DomainError extends Error {
  readonly code: ErrorCodeValue;
  readonly status: number;
  readonly details: Record<string, unknown>;
  /** Whether the message and `details` survive a 5xx. See {@link DomainErrorOptions.callerSafe}. */
  readonly callerSafe: boolean;
  readonly logDetail: string | undefined;

  constructor(code: ErrorCodeValue, message: string, options: DomainErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'DomainError';
    this.code = code;
    // A caller may override the status, but only upward into 5xx — a 4xx code
    // reported as a 500 would turn a client error into an operational alert.
    this.status = options.status ?? STATUS_BY_CODE[code];
    this.details = options.details ?? {};
    this.callerSafe = options.callerSafe === true;
    this.logDetail = options.logDetail;
  }

  /**
   * The response body for this error, and the one place the 5xx rules live.
   *
   * A 5xx says `internal error` and no details, because a server fault must not
   * describe itself — with the single exception this class records as
   * `callerSafe`, for a 5xx that answers about a resource the caller named.
   *
   * @param requestId the id the caller will quote in a report
   */
  toBody(requestId: string): { error: Record<string, unknown> } {
    const internal = this.status >= 500 && !this.callerSafe;
    return {
      error: {
        code: this.code,
        message: internal ? 'internal error' : this.message,
        requestId,
        details: internal ? {} : this.details,
      },
    };
  }

  /** The full text for the server log: the public message plus any log-only detail. */
  logMessage(): string {
    return this.logDetail === undefined ? this.message : `${this.message} — ${this.logDetail}`;
  }
}

export function isDomainError(value: unknown): value is DomainError {
  return value instanceof DomainError;
}

/** The default status for a code. Exported so tests can assert the mapping. */
export function statusForCode(code: ErrorCodeValue): number {
  return STATUS_BY_CODE[code];
}

/** The full code→status table, for the boundary check that keeps them in step. */
export function errorCodeTable(): Record<ErrorCodeValue, number> {
  return { ...STATUS_BY_CODE };
}
