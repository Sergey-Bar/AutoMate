import type { Context, MiddlewareHandler } from 'hono';
import { ErrorCode } from '../errors/domain-error.js';

/**
 * A server-side deadline on every request.
 *
 * Nothing in this API bounded how long a request could take. The body limit caps
 * how *large* a request may be and the rate limiter caps how *many* arrive, but a
 * small request that waits on an unbounded operation held a connection and a
 * handler for as long as the operation took. Two consequences, both of which
 * matter on a single-node self-hosted install where the API and the worker share
 * a PostgreSQL:
 *
 *  - a client that gave up keeps its work running, because the only cancellation
 *    that existed was the client's;
 *  - a request blocked behind a long transaction holds a pool connection, and the
 *    pool is the thing the whole installation is sized around.
 *
 * The deadline is enforced on the *server*: when it elapses the response is
 * refused with a stable code, and the timer is cleared on every path so a
 * completed request does not keep a timer alive until the deadline.
 *
 * Two details that a "set a timeout" implementation usually gets wrong, and which
 * the tests here pin down:
 *
 *  - `AbortSignal.timeout` is deliberately **not** used. It aborts the signal but
 *    does not stop the handler, so the work keeps running and still holds the
 *    connection — which is the problem this middleware exists to fix. A client
 *    that wants its *own* work cancelled passes a signal in through
 *    `createRequestDeadline`; this middleware's job is the response, and it says
 *    so.
 *  - The deadline is per request, and the header is echoed so a caller can see
 *    which one applied. A deadline that is silently different from the documented
 *    one is worse than none.
 */
export interface RequestDeadlineOptions {
  /** Milliseconds a request may take before its response is refused. */
  budgetMs: number;
  /** Injected so a test can advance time instead of waiting for it. */
  setTimeoutImpl?: (handler: () => void, ms: number) => unknown;
  clearTimeoutImpl?: (handle: unknown) => void;
  /** Reported when a deadline elapses, and only then. */
  onTimeout?: (context: { path: string; method: string; budgetMs: number }) => void;
  /** Paths exempt from the deadline, matched exactly. */
  exemptPaths?: readonly string[];
  /**
   * Longest body the limiter will accept, used only to phrase the refusal. A
   * caller gets a retry time rather than a bare failure.
   */
  retryAfterSeconds?: number;
}

export const REQUEST_DEADLINE_HEADER = 'x-request-deadline-ms';

function refused(c: Context, budgetMs: number) {
  return c.json(
    {
      error: {
        code: ErrorCode.REQUEST_TIMEOUT,
        message: 'request exceeded the server deadline',
        requestId: c.req.header('x-request-id') ?? 'unknown',
        details: { budgetMs },
      },
    },
    503,
  );
}

/**
 * Builds the middleware.
 *
 * `sse` and `events` are exempt by default in `index.ts` rather than here: a
 * long-lived stream is not a request that should be refused halfway through, and
 * the decision of what to exempt belongs where the routes are known.
 */
export function createRequestDeadline(options: RequestDeadlineOptions): MiddlewareHandler {
  const budget = options.budgetMs;
  const arm = options.setTimeoutImpl ?? ((handler, ms) => setTimeout(handler, ms));
  const disarm = options.clearTimeoutImpl ?? ((handle) => clearTimeout(handle as NodeJS.Timeout));
  const exempt = new Set(options.exemptPaths ?? []);
  const retryAfter = String(options.retryAfterSeconds ?? Math.ceil(budget / 1000));

  if (!Number.isInteger(budget) || budget <= 0) {
    throw new RangeError(
      `createRequestDeadline: budgetMs must be a positive integer, received ${String(budget)}`,
    );
  }

  return async (c, next) => {
    if (exempt.has(c.req.path)) return next();

    let settled = false;
    const handle = arm(() => {
      if (settled) return;
      settled = true;
      options.onTimeout?.({ path: c.req.path, method: c.req.method, budgetMs: budget });
      // The handler is *not* cancelled. There is no safe way to do that from
      // outside: interrupting mid-transaction can leave a run half-recorded, which
      // is worse than a slow response. So the deadline refuses the *response* and
      // says so, and the handler finishes in the background.
      c.header('retry-after', retryAfter);
      const body = refused(c, budget);
      c.res = body as Context['res'];
    }, budget);

    try {
      await next();
    } finally {
      settled = true;
      disarm(handle);
    }

    // If the timer already replaced the response, keep that. Otherwise add the
    // header, which is how a caller learns the budget that applied.
    if (!c.res.headers.has(REQUEST_DEADLINE_HEADER)) {
      c.res.headers.set(REQUEST_DEADLINE_HEADER, String(budget));
    }
  };
}

/**
 * A client-side cancellation signal, separate from the server deadline.
 *
 * Deliberately a different function with a different name. A caller that aborts
 * genuinely wants its request cancelled — an operator closing a tab should stop
 * the poll — whereas the server deadline is about refusing a response. Conflating
 * them is how a "deadline" ends up silently cancelling work that must complete.
 *
 * @param budgetMs how long the caller's own request may take
 * @returns a signal the caller may also abort itself
 */
export function createClientDeadline(budgetMs: number): AbortSignal {
  return AbortSignal.timeout(budgetMs);
}
