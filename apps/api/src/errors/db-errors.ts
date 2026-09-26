import { DomainError, ErrorCode, type ErrorCodeValue } from './domain-error.js';

/**
 * Translates a Postgres error into a `DomainError`.
 *
 * Drizzle and `pg` throw the driver's own error, which carries a `code`
 * (SQLSTATE) and nothing a caller can branch on. Every constraint the schema
 * declares therefore reached the client as an unclassified 500, so a caller
 * whose state transition the database rejected retried a request that could
 * never succeed.
 *
 * The mapping is by SQLSTATE class, not by constraint name, so it stays correct
 * as constraints are added, and the constraint name goes in the log rather than
 * the response.
 */
interface SqlStateRule {
  code: ErrorCodeValue;
  message: string;
}

/** SQLSTATE → classified error. */
const RULES: Record<string, SqlStateRule> = {
  // Class 23 — integrity constraint violation. Each one is the caller's request
  // conflicting with a declared invariant.
  '23000': { code: ErrorCode.VALIDATION_FAILED, message: 'database constraint violated' },
  '23001': { code: ErrorCode.VALIDATION_FAILED, message: 'restrict violation' },
  // unique_violation
  '23505': { code: ErrorCode.DUPLICATE, message: 'a row with that identity already exists' },
  // foreign_key_violation
  '23503': { code: ErrorCode.VALIDATION_FAILED, message: 'referenced row does not exist' },
  // not_null_violation
  '23502': { code: ErrorCode.MISSING_REQUIRED_FIELD, message: 'a required field was absent' },
  // check_violation — the case the plan names: a state transition or an evidence
  // rule the schema enforces, which used to be a 500.
  '23514': {
    code: ErrorCode.CHECK_CONSTRAINT_VIOLATED,
    message: 'the request violates a database invariant',
  },
  // exclusion_violation
  '23P01': { code: ErrorCode.VALIDATION_FAILED, message: 'exclusion constraint violated' },

  // Class 22 — data exception. A malformed value, not a broken service.
  '22000': { code: ErrorCode.INVALID_REQUEST, message: 'invalid data value' },
  // string_data_right_truncation
  '22001': { code: ErrorCode.INVALID_REQUEST, message: 'value out of range' },
  // numeric_value_out_of_range
  '22003': { code: ErrorCode.INVALID_REQUEST, message: 'numeric value out of range' },
  // invalid_datetime_format
  '22007': { code: ErrorCode.INVALID_REQUEST, message: 'invalid datetime value' },
  // invalid_text_representation
  '22P02': {
    code: ErrorCode.INVALID_REQUEST,
    message: 'invalid text representation for a column type',
  },

  // Class 40 — transaction rollback. `40001` is retryable, so it is a 409 with a
  // distinct code rather than the 500 a bare driver error produced.
  '40001': {
    code: ErrorCode.SERIALIZATION_FAILED,
    message: 'the transaction could not be serialised; retry the request',
  },
  // deadlock_detected
  '40P01': {
    code: ErrorCode.SERIALIZATION_FAILED,
    message: 'the transaction deadlocked; retry the request',
  },

  // Class 08 — connection. Not the caller's fault.
  '08000': { code: ErrorCode.DEPENDENCY_UNAVAILABLE, message: 'connection failure' },
  '08001': { code: ErrorCode.DEPENDENCY_UNAVAILABLE, message: 'unable to connect' },
  '08003': { code: ErrorCode.DEPENDENCY_UNAVAILABLE, message: 'connection does not exist' },
  '08004': { code: ErrorCode.DEPENDENCY_UNAVAILABLE, message: 'server rejected the connection' },
  '08006': { code: ErrorCode.DEPENDENCY_UNAVAILABLE, message: 'connection failure' },
  '08007': { code: ErrorCode.DEPENDENCY_UNAVAILABLE, message: 'transaction resolution unknown' },
  '08P01': { code: ErrorCode.DEPENDENCY_UNAVAILABLE, message: 'protocol violation' },

  // Class 53 — insufficient resources. Transient, and not the caller's fault.
  '53000': { code: ErrorCode.DEPENDENCY_UNAVAILABLE, message: 'insufficient resources' },
  '53100': { code: ErrorCode.DEPENDENCY_UNAVAILABLE, message: 'disk full' },
  '53200': { code: ErrorCode.DEPENDENCY_UNAVAILABLE, message: 'out of memory' },
  '53300': { code: ErrorCode.DEPENDENCY_UNAVAILABLE, message: 'too many connections' },

  // Class 57 — operator intervention: shutdown, admin command, statement timeout.
  '57014': { code: ErrorCode.DEPENDENCY_UNAVAILABLE, message: 'statement cancelled by the server' },
  '57P01': { code: ErrorCode.DEPENDENCY_UNAVAILABLE, message: 'server is shutting down' },
  '57P02': { code: ErrorCode.DEPENDENCY_UNAVAILABLE, message: 'server is crashing' },
  '57P03': { code: ErrorCode.DEPENDENCY_UNAVAILABLE, message: 'server cannot connect now' },
};

/** The `pg`/`DrizzlePostgresError` shape this reads, structurally. */
interface DriverError {
  code?: unknown;
  constraint?: unknown;
  cause?: unknown;
  message?: unknown;
}

/** How far down a cause chain to look. Three covers Drizzle and `pg` nesting. */
const MAX_CAUSE_DEPTH = 3;

/**
 * Finds the SQLSTATE on a thrown value, following the `cause` chain.
 *
 * Drizzle does not rethrow the driver's error: it throws its own `Error` whose
 * message is `Failed query: …` and whose `cause` is the `pg` error carrying the
 * code. A classifier that only reads the top level therefore classifies *every*
 * Drizzle error as `INTERNAL`, which is precisely the bare-500 behaviour this
 * module exists to remove — and it fails silently, because `INTERNAL` is a
 * perfectly valid answer.
 */
function findSqlState(error: unknown): { sqlState: string; constraint?: string } | undefined {
  let current: unknown = error;
  for (
    let depth = 0;
    depth <= MAX_CAUSE_DEPTH && current !== null && current !== undefined;
    depth += 1
  ) {
    const candidate = current as DriverError;
    if (typeof candidate.code === 'string' && candidate.code.length === 5) {
      return {
        sqlState: candidate.code,
        constraint: typeof candidate.constraint === 'string' ? candidate.constraint : undefined,
      };
    }
    current = candidate.cause;
  }
  return undefined;
}

/**
 * Wraps a thrown value as a `DomainError`.
 *
 * A value that is already a `DomainError` is returned unchanged, so a store
 * that classified its own failure is not reclassified. A recognised SQLSTATE is
 * mapped. Anything else becomes `INTERNAL` with the original kept as `cause`,
 * never surfaced in the response.
 */
export function classifyDatabaseError(error: unknown): DomainError {
  if (error instanceof DomainError) return error;

  const found = findSqlState(error);
  const rule = found === undefined ? undefined : RULES[found.sqlState];

  if (rule === undefined || found === undefined) {
    const sqlState = found?.sqlState;
    return new DomainError(
      ErrorCode.INTERNAL,
      `unclassified database error${sqlState === undefined ? '' : ` (SQLSTATE ${sqlState})`}`,
      { cause: error },
    );
  }

  // The constraint name is log-only: it names an internal object and tells a
  // caller more about the schema than they need. The response carries the
  // generic message and the SQLSTATE, which is enough to act on.
  return new DomainError(rule.code, rule.message, {
    details: { sqlState: found.sqlState },
    logDetail:
      found.constraint === undefined
        ? `SQLSTATE ${found.sqlState}`
        : `SQLSTATE ${found.sqlState}, constraint ${found.constraint}`,
    cause: error,
  });
}

/**
 * True when a thrown value carries a SQLSTATE, on it or anywhere on its cause
 * chain.
 */
export function hasSqlState(error: unknown): boolean {
  return findSqlState(error) !== undefined;
}

/** The SQLSTATE→code table, exported so the mapping can be asserted directly. */
export function sqlStateRules(): Record<string, ErrorCodeValue> {
  const table: Record<string, ErrorCodeValue> = {};
  for (const [sqlState, rule] of Object.entries(RULES)) table[sqlState] = rule.code;
  return table;
}

/**
 * Wraps an async database call so a driver error arrives as a `DomainError`.
 *
 * Applied at the store, not only at the HTTP boundary, for two reasons: a caller
 * that is not the HTTP route — the worker's lease reaper, the retention sweep —
 * gets a typed error with a code it can branch on; and the error carries a real
 * type, so `instanceof DomainError` works instead of duck-typing a `code`
 * property that might be something else entirely.
 */
export async function classified<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw classifyDatabaseError(error);
  }
}

/**
 * Wraps every method of a store so none can leak a raw driver error.
 *
 * Wrapping method by method misses the ones nobody remembers, and a missed one
 * is exactly the defect this exists to remove: it surfaces as a bare 500 and a
 * caller who retries a request the database will always reject. A proxy at the
 * composition root covers all of them by construction.
 *
 * The wrapped value is only a pass-through for a bound method; a non-function
 * property (a constant, a symbol) is returned untouched, and `this` stays bound
 * to the real store.
 */
export function withClassifiedErrors<T extends object>(store: T): T {
  return new Proxy(store, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver) as unknown;
      if (typeof value !== 'function') return value;
      const method = value as (...args: unknown[]) => unknown;
      return (...args: unknown[]) => classified(async () => method.apply(target, args) as unknown);
    },
  });
}
