import type { Context, ErrorHandler, NotFoundHandler } from 'hono';
import { ErrorCode, isDomainError } from './domain-error.js';
import { classifyDatabaseError } from './db-errors.js';

export interface ErrorBoundaryOptions {
  /** Where the log line goes. Injected so tests can assert what was logged. */
  log?: (message: string, context: Record<string, unknown>) => void;
  /** The request id attached to every error response. */
  requestId: (c: Context) => string;
}

function requestIdFromHeader(c: Context, fallback: string): string {
  const header = c.req.header('x-request-id');
  return header !== undefined && header.trim() !== '' ? header.trim() : fallback;
}

/**
 * The application's single error boundary.
 *
 * Before this, Hono's default handler produced a bare 500 for anything a
 * handler threw, so a Postgres CHECK violation — a state transition the schema
 * rejects — was indistinguishable from a defect, and a serialization failure
 * (retryable) was indistinguishable from either.
 *
 * Now every response carries a stable `code`. A `DomainError` renders its own
 * code and status. A database error is classified by SQLSTATE. Anything else
 * becomes `INTERNAL` with the detail kept in the log, because an unrecognised
 * error is by definition a defect and its message is not safe to return.
 */
export function createErrorBoundary(options: ErrorBoundaryOptions): {
  onError: ErrorHandler;
  notFound: NotFoundHandler;
} {
  const log = options.log ?? ((message, context) => console.error(message, context));

  const onError: ErrorHandler = (error, c) => {
    const requestId = options.requestId(c);
    const path = c.req.path;
    const method = c.req.method;

    if (isDomainError(error)) {
      if (error.status >= 500) {
        log('request failed', {
          requestId,
          path,
          method,
          code: error.code,
          error: error.logMessage(),
        });
      } else if (error.logDetail !== undefined) {
        // A 4xx whose log detail names an internal object: the caller gets the
        // code and the safe message, the log gets the detail.
        log('request rejected', {
          requestId,
          path,
          method,
          code: error.code,
          error: error.logMessage(),
        });
      }
      return c.json(
        {
          error: {
            code: error.code,
            message: error.status >= 500 ? 'internal error' : error.message,
            requestId,
            details: error.status >= 500 ? {} : error.details,
          },
        },
        error.status as 400,
      );
    }

    const classified = classifyDatabaseError(error);
    if (classified.code !== ErrorCode.INTERNAL) {
      // A classified database failure. The constraint or SQLSTATE detail goes to
      // the log for every status, because a 4xx is still a caller-facing answer
      // and must not carry it.
      if (classified.status >= 500 || classified.logDetail !== undefined) {
        log(classified.status >= 500 ? 'dependency failure' : 'request rejected', {
          requestId,
          path,
          method,
          code: classified.code,
          error: classified.logMessage(),
        });
      }
      return c.json(
        {
          error: {
            code: classified.code,
            message: classified.status >= 500 ? 'dependency unavailable' : classified.message,
            requestId,
            details: classified.status >= 500 ? {} : classified.details,
          },
        },
        classified.status as 400,
      );
    }

    log('unhandled error', {
      requestId,
      path,
      method,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return c.json(
      {
        error: {
          code: ErrorCode.INTERNAL,
          // Nothing about the cause. A stack trace or a SQL fragment in a
          // response is an information disclosure, and a caller cannot act on it
          // anyway — the request id is what correlates them with the log.
          message: 'internal error',
          requestId,
          details: {},
        },
      },
      500,
    );
  };

  const notFound: NotFoundHandler = (c) =>
    c.json(
      {
        error: {
          code: ErrorCode.NOT_FOUND,
          message: 'not found',
          requestId: requestIdFromHeader(c, 'unknown'),
          details: {},
        },
      },
      404,
    );

  return { onError, notFound };
}

/** Re-exported so route modules have one import for the taxonomy. */
export { DomainError, ErrorCode } from './domain-error.js';
export type { ErrorCodeValue } from './domain-error.js';
