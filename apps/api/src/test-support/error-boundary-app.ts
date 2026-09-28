import { Hono } from 'hono';
import { createErrorBoundary } from '../errors/boundary.js';
import { requestContext } from '../observability/request-context.js';

/**
 * Mount a route group the way `index.ts` mounts it: request context first, then the
 * error boundary, then the routes.
 *
 * The order is the content, and the first version of this helper got it wrong in a way
 * that only one test could see. Without `requestContext` the `AsyncLocalStorage` store
 * is never populated, so `requireRequestId()` returns `null` and every audit row a
 * handler writes records `requestId: null` — while the header the test sent sat unused.
 * A quarantine write that attributes itself to no request is exactly the defect the
 * request-id column exists to prevent, and the harness was manufacturing it.
 *
 * Since finding C-3 a handler refuses by `throw`ing a `DomainError`, and
 * `errors/boundary.ts` is what renders it. A bare `Hono` has no boundary, so mounting a
 * route group into one and driving it from a test answers 500 for every refusal — which
 * is not a bug in the routes, and is the sort of thing that gets "fixed" by putting a
 * response-building helper back.
 *
 * `requestId` falls back to the header when the test sent one and to the marker
 * otherwise, so a test that cares asserts on a real id and a test that does not is not
 * paying for a UUID per request.
 *
 * `routes` may be a `Hono` or the `{ app, … }` object several route factories return.
 * The distinction is invisible at the call site — `createAuthRoutes({ … })` and
 * `createExecutionRoutes({ … })` differ in shape — and a helper that only accepted the
 * first would have needed two helpers, or a `.app` at every call.
 */
export function withErrorBoundary(routes: Hono | { app: Hono }): Hono {
  const { onError } = createErrorBoundary({
    log: () => undefined,
    reportError: () => undefined,
    requestId: (c) => c.req.header('x-request-id') ?? 'NO_REQUEST',
  });
  const group = 'app' in routes ? routes.app : routes;
  return new Hono().use(requestContext).onError(onError).route('/', group);
}
