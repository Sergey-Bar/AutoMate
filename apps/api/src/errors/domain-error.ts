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
  MISSING_REQUIRED_FIELD: 'MISSING_REQUIRED_FIELD',

  // 401 / 403 — authentication and authorisation.
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  RUNNER_UNAUTHORIZED: 'RUNNER_UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',

  // 404 — addressed something that does not exist, or must not be visible.
  NOT_FOUND: 'NOT_FOUND',
  RUN_NOT_FOUND: 'RUN_NOT_FOUND',
  JOB_NOT_FOUND: 'JOB_NOT_FOUND',
  ARTIFACT_NOT_FOUND: 'ARTIFACT_NOT_FOUND',
  ARTIFACT_UNREADABLE: 'ARTIFACT_UNREADABLE',

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

  // 413 — too large.
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',

  // 422 — well-formed, but violates a domain invariant the database enforces.
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  EVIDENCE_INCOMPLETE: 'EVIDENCE_INCOMPLETE',
  CHECK_CONSTRAINT_VIOLATED: 'CHECK_CONSTRAINT_VIOLATED',

  // 503 — a dependency is unavailable.
  DEPENDENCY_UNAVAILABLE: 'DEPENDENCY_UNAVAILABLE',
  NOT_CONFIGURED: 'NOT_CONFIGURED',

  // 500 — a defect. The response says nothing about the cause.
  INTERNAL: 'INTERNAL',
  /**
   * A row or artifact that the canonical schema rejected. A 500, because it means
   * our own projection disagrees with our own contract — but a distinct code, so
   * it can be alerted on separately and the offending field identified from the
   * log rather than from a generic failure count.
   */
  RUN_SERIALIZATION_FAILED: 'RUN_SERIALIZATION_FAILED',
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

const STATUS_BY_CODE: Record<ErrorCodeValue, number> = {
  INVALID_REQUEST: 400,
  INVALID_JSON: 400,
  MISSING_REQUIRED_FIELD: 400,

  UNAUTHENTICATED: 401,
  RUNNER_UNAUTHORIZED: 401,
  FORBIDDEN: 403,

  NOT_FOUND: 404,
  RUN_NOT_FOUND: 404,
  JOB_NOT_FOUND: 404,
  ARTIFACT_NOT_FOUND: 404,
  ARTIFACT_UNREADABLE: 404,

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

  PAYLOAD_TOO_LARGE: 413,

  VALIDATION_FAILED: 422,
  EVIDENCE_INCOMPLETE: 422,
  CHECK_CONSTRAINT_VIOLATED: 422,

  DEPENDENCY_UNAVAILABLE: 503,
  NOT_CONFIGURED: 503,

  INTERNAL: 500,
  RUN_SERIALIZATION_FAILED: 500,
};

export interface DomainErrorOptions {
  status?: number;
  /** Safe to return to the caller. Never include a value, token or path. */
  details?: Record<string, unknown>;
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
  readonly logDetail: string | undefined;

  constructor(code: ErrorCodeValue, message: string, options: DomainErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'DomainError';
    this.code = code;
    // A caller may override the status, but only upward into 5xx — a 4xx code
    // reported as a 500 would turn a client error into an operational alert.
    this.status = options.status ?? STATUS_BY_CODE[code];
    this.details = options.details ?? {};
    this.logDetail = options.logDetail;
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
