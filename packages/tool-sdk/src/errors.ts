import {
  ConnectorHttpError,
  ConnectorInputError,
  ConnectorRejectionError,
} from '@automate/connectors-sdk';

/**
 * What a caller can do about a failure, which is the only reason to classify one.
 *
 * - `retryable`: the tool did not answer in time or said it was unavailable. Trying again
 *   later may succeed. Whether the SDK already tried is `attempts`, not this field.
 * - `configuration`: there is no adapter, or the tool it drives is not installed. Trying
 *   again changes nothing until an operator does something. This is the `501` kind.
 * - `tool_failure`: the tool ran and failed, or produced output nobody can use.
 * - `invalid_input`: the request was wrong. Repeating it verbatim cannot help.
 */
export type ToolErrorKind = 'retryable' | 'configuration' | 'tool_failure' | 'invalid_input';

/**
 * What an adapter throws when the tool it drives is not there: the binary is missing, the
 * credential is unset, the image was never pulled. Classified as `configuration`, so it is
 * rendered as the same `501 AGENT_NOT_CONFIGURED` an unregistered pair gets - one answer to
 * "this cannot run here yet", whichever layer noticed.
 */
export class ToolConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolConfigurationError';
  }
}

/**
 * The tool found the request wrong in a way only it could see - an id that names nothing, a
 * target it refuses. Classified `invalid_input`, so the caller gets a `400` with this message
 * rather than a `502` that blames the tool, and it is not retried.
 */
export class ToolInputError extends ConnectorInputError {
  constructor(message: string) {
    super('AGENT_INVALID_INPUT', message);
    this.name = 'ToolInputError';
  }
}

/** The tool ran and failed. `code` is the stable, caller-readable name of how. */
export class ToolFailureError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ToolFailureError';
  }
}

/**
 * The tool did not answer, or said it was unavailable, and it may have done the work anyway.
 *
 * A {@link ConnectorHttpError}, so `executeWithRetry` applies its own rule: repeated only when
 * the operation declares itself idempotent. `status` must be one `isRetryableStatus` accepts
 * for the failure to be classified `retryable`; 503 is the default because "unavailable" is
 * what an adapter usually means.
 */
export class ToolTransientError extends ConnectorHttpError {
  constructor(message: string, status = 503) {
    super(status, message);
    this.name = 'ToolTransientError';
  }
}

/** The deadline fired. Retried on the same terms as any {@link ToolTransientError}. */
export class ToolTimeoutError extends ToolTransientError {
  constructor(message: string) {
    super(message, 504);
    this.name = 'ToolTimeoutError';
  }
}

/**
 * The tool refused the request and said it did nothing - queue full, rate limited.
 *
 * A {@link ConnectorRejectionError}: safe to repeat whatever the operation's idempotency,
 * which is finding P-13's second half. Only throw this when the tool really did not start.
 */
export class ToolRefusedError extends ConnectorRejectionError {
  constructor(message: string, status = 503) {
    super(status, message);
    this.name = 'ToolRefusedError';
  }
}

/** The caller aborted. Never retried, and not the tool's fault. */
export class ToolCancelledError extends Error {
  constructor(message = 'Tool operation cancelled', options?: { cause: unknown }) {
    super(message, options);
    this.name = 'ToolCancelledError';
  }
}
