import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';

/**
 * One request, one id, for the whole execution.
 *
 * The request id was re-derived from the header at six independent sites — the error
 * boundary, the deadline middleware, the shared execution helper, the two dashboard
 * audit writers, and the composition root — with **different fallbacks at each**: some
 * generated a UUID, one stored `null`, one stored the literal `'unknown'`. So a single
 * execution could not be traced by a single id from the log line to the event row to the
 * artifact metadata, which is the whole purpose of having one (ledger O-1b).
 *
 * The other half of that finding is that the id is **attacker-controlled** and flows
 * into logs and persisted audit rows. Six sites each deciding independently whether to
 * trust it is six places to get the sanitising wrong. `normaliseRequestId` is the only
 * place that decides, and it is deliberately strict: a value that is not a short
 * identifier is replaced rather than truncated, because a truncated attacker string is
 * still an attacker string, and a log line is not the place to be lenient about what
 * another system will parse out of it.
 */

/** Anything longer than this is not an identifier; it is something being sent. */
const MAX_REQUEST_ID_LENGTH = 64;

/** The shape we accept from a client. Printable, no whitespace, no control characters. */
const ACCEPTED = /^[A-Za-z0-9._-]{1,64}$/;

const storage = new AsyncLocalStorage<{ requestId: string }>();

/**
 * The id to use for a request, whether it came from the client or from us.
 *
 * A client-supplied value is accepted only when it looks like an identifier. Anything
 * else — empty, whitespace, over-long, containing a space or a control character — is
 * replaced with a generated UUID, because this value is written to logs and to audit
 * rows and must not be able to forge a delimiter or inject a line.
 *
 * @param header the raw `x-request-id` value, if any
 * @returns an id safe to log, persist and correlate
 */
export function normaliseRequestId(header: string | undefined | null): string {
  if (typeof header !== 'string') return randomUUID();
  const trimmed = header.trim();
  if (trimmed === '' || trimmed.length > MAX_REQUEST_ID_LENGTH) return randomUUID();
  return ACCEPTED.test(trimmed) ? trimmed : randomUUID();
}

/**
 * The current request's id.
 *
 * Outside a request — a bootstrap error, a background job, a test — this returns
 * `undefined` rather than inventing one, because a fabricated id in a log line is
 * worse than an absent one: it looks correlatable and is not. Callers that must have a
 * value use {@link requireRequestId}, which says so in the message it prints.
 *
 * @returns the id for the request in flight, or `undefined` outside one
 */
export function currentRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}

/**
 * The current request's id, or a marker that admits there is none.
 *
 * For a log line or a persisted row that must always be populated. The fallback is a
 * fixed, obvious string rather than a fresh UUID, because a fresh UUID here would be
 * indistinguishable from a real id and would defeat the search it exists to support.
 *
 * @returns the request id, or `NO_REQUEST`
 */
export function requireRequestId(): string {
  return currentRequestId() ?? 'NO_REQUEST';
}

/**
 * Run a callback with a request id in scope.
 *
 * Exposed separately from the middleware so a background job or a test can establish
 * the same context the HTTP path does, rather than there being one way in and a second
 * way each of everything else does.
 *
 * @param requestId the id for this execution
 * @param work what to run
 * @returns whatever `work` returns
 */
export function runWithRequestId<T>(requestId: string, work: () => T): T {
  return storage.run({ requestId }, work);
}

/**
 * Establish the request id for the rest of the chain, and echo it back.
 *
 * The response header matters as much as the context: a client that cannot see the id
 * it got cannot quote it in a bug report, and a generated id it never sees is useless
 * for correlation from the outside.
 *
 * Registered before anything that logs, so the earliest failure already has an id.
 */
export const requestContext: MiddlewareHandler = async (c, next) => {
  const requestId = normaliseRequestId(c.req.header('x-request-id'));
  c.header('x-request-id', requestId);
  await runWithRequestId(requestId, () => next());
};
