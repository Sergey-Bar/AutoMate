export interface ConnectorManifest {
  name: string;
  version: string;
  operations: Record<string, { sideEffecting: boolean; idempotent: boolean; timeoutMs: number }>;
}

export interface ConnectorRequest {
  operation: string;
  input: unknown;
  signal?: AbortSignal;
}

export interface ConnectorResult {
  status: 'ok' | 'error';
  data?: unknown;
  error?: { code: string; retryable: boolean; message: string };
  attempts: number;
}

export interface ConnectorAdapter {
  manifest: ConnectorManifest;
  execute(request: ConnectorRequest, secret: string): Promise<ConnectorResult>;
}

/**
 * The caller asked for something this adapter cannot do.
 *
 * Distinct from a remote failure in the only way that matters to a caller: repeating it
 * verbatim will not change the answer, so `retryable` is false for these. An adapter that
 * cannot distinguish "your request was wrong" from "Slack was unwell" reports both as the
 * second, and a caller that trusts the flag spends its whole budget on a typo.
 */
export class ConnectorInputError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ConnectorInputError';
  }
}

/**
 * The remote system refused, and said it did nothing.
 *
 * This is the distinction finding P-13 turns on, and it is not a subtlety for its own
 * sake. A 502 is a statement about the *response*: the request may have been performed in
 * full before the response failed to arrive, so for an operation that creates something,
 * repeating it duplicates the thing. An `ok: false` from Slack is a statement about the
 * *request*: the message was rejected before it was accepted, so repeating it cannot
 * produce a second message — even though `postMessage` is not idempotent.
 *
 * So the retry rule is not "idempotent ⇒ retry" but "idempotent **or** known-rejected ⇒
 * retry", and both halves are needed: the first stops the duplication, the second stops a
 * rate-limited caller being told to fail rather than to wait.
 */
export class ConnectorHttpError extends Error {
  /**
   * How many attempts were actually made, including this one.
   *
   * Set by {@link executeWithRetry} when it gives up, because the error is constructed
   * inside the caller's operation and cannot know the count itself. An adapter reporting
   * `attempts: 1` after three HTTP calls is a wrong number in an evidence trail, and
   * `attempts` is the field that tells a reader whether a failure was retried.
   */
  attempts = 1;

  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
export class ConnectorRejectionError extends ConnectorHttpError {
  constructor(status: number, message: string) {
    super(status, message);
    this.name = 'ConnectorRejectionError';
  }
}

/**
 * The manifest's entry for an operation, or a refusal naming what does exist.
 *
 * Every adapter answered the same request regardless of what the caller asked for, which
 * is why each one could declare operations in its manifest that were unreachable. A
 * dispatcher that cannot name an operation cannot silently ignore one, and the refusal
 * carries the declared names because a caller who guessed wrong needs to be told the right
 * spelling, not told no.
 *
 * @throws {ConnectorInputError} `unknown_operation` when the manifest does not declare it
 */
export function operationSpec(
  manifest: ConnectorManifest,
  operation: string,
): { sideEffecting: boolean; idempotent: boolean; timeoutMs: number } {
  const spec = manifest.operations[operation];
  if (spec === undefined) {
    throw new ConnectorInputError(
      'unknown_operation',
      `${manifest.name} does not declare an operation named "${operation}"; it declares: ${Object.keys(
        manifest.operations,
      )
        .sort()
        .join(', ')}`,
    );
  }
  return spec;
}

/**
 * A required field from a connector's `input`, as a string.
 *
 * `ConnectorRequest.input` is `unknown`, so an adapter that reads it by casting gets a
 * runtime failure at the far end of a network round trip. This refuses at the edge and names
 * the field.
 *
 * @throws {ConnectorInputError} `invalid_input` when absent, blank or not a string
 */
export function requireString(input: unknown, field: string): string {
  if (typeof input !== 'object' || input === null) {
    throw new ConnectorInputError('invalid_input', `input must be an object carrying "${field}"`);
  }
  const value = (input as Record<string, unknown>)[field];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ConnectorInputError('invalid_input', `input.${field} must be a non-empty string`);
  }
  return value;
}

/** An object field from a connector's `input`, or `{}` when it is absent. */
export function optionalObject(input: unknown, field: string): Record<string, unknown> {
  if (typeof input !== 'object' || input === null) return {};
  const value = (input as Record<string, unknown>)[field];
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Whether a status is worth another attempt, and `false` for **no status at all**.
 *
 * The absent case is a parameter rather than a caller-side guard because every adapter
 * has the same shape: it holds `error.status` narrowed to `number | undefined`, and a
 * failure with no status is a remote that never answered. A signature of `number` made
 * each of them hand-roll the check, and two of the three had it wrong — the ones that
 * invented a 500 for a dead socket found `isRetryableStatus(500)` and reported a
 * transient fault that would not clear.
 *
 * Typed this way, the impossible answer is unrepresentable: there is no status that means
 * "retry me", and "nothing answered" is not one of them.
 */
export function isRetryableStatus(status: number | undefined): boolean {
  if (status === undefined) return false;
  return [408, 425, 429, 500, 502, 503, 504].includes(status);
}

/** How many attempts a failed operation actually made, for an honest result. */
export function attemptsOf(error: unknown): number {
  return error instanceof ConnectorHttpError ? error.attempts : 1;
}

/**
 * Run an operation, retrying only when repeating it is safe.
 *
 * `idempotent` is the manifest's own claim about the operation, and it is the whole of
 * finding P-13: `manifest.operations[op].idempotent` is in this package and was never read,
 * because this function had no parameter through which it could arrive. A 502 arriving after
 * a create produced three issues and reported one failure.
 *
 * The other half is {@link ConnectorRejectionError}: a refusal the remote system reported
 * about the *request* is safe to repeat whatever the operation's idempotency, and without
 * that the policy would tell a rate-limited caller to fail rather than to wait.
 */
export async function executeWithRetry<T>(
  operation: () => Promise<T>,
  options: {
    retries: number;
    /** The manifest's claim. Absent means "not known to be safe", which is the safe default. */
    idempotent?: boolean;
    signal?: AbortSignal;
    sleep?: (ms: number) => Promise<void>;
  },
): Promise<{ value: T; attempts: number }> {
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  let attempts = 0;
  while (true) {
    attempts += 1;
    try {
      return { value: await operation(), attempts };
    } catch (error) {
      const transient = error instanceof ConnectorHttpError && isRetryableStatus(error.status);
      // Absent `idempotent` is treated as false, not true: an adapter that forgets to
      // pass the manifest's claim must lose the retry, because the cost of that mistake is
      // a duplicated side effect and the cost of the opposite is one failed request.
      const safeToRepeat = options.idempotent === true || error instanceof ConnectorRejectionError;
      if (!transient || !safeToRepeat || attempts > options.retries) {
        if (error instanceof ConnectorHttpError) error.attempts = attempts;
        throw error;
      }
      // Checked before the backoff, not after. A cancelled caller has already given up,
      // and making it wait out a 400ms sleep before the cancellation is honoured is time
      // the caller has already decided not to spend.
      if (options.signal?.aborted) throw new Error('Connector operation cancelled');
      await sleep(100 * 2 ** (attempts - 1));
    }
  }
}
