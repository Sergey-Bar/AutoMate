/**
 * Reconnection state and exponential-backoff-with-jitter for WebSocket clients.
 *
 * ```ts
 * let attempt = 0;
 * const scheduleReconnect = () => {
 *   state = 'reconnecting';
 *   setTimeout(connect, computeBackoff(++attempt, 1_000, 30_000));
 * };
 * ```
 *
 * The delay is `min(baseMs * 2^(attempt-1) + rand(0, baseMs * 1.5), maxMs)`.
 */

/** Connection lifecycle states for a managed WebSocket client */
export type ReconnectState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'failed';

/**
 * Compute the next reconnect delay using exponential backoff with jitter.
 *
 * Every argument is coerced to a usable number first, which is the whole of ledger
 * R-7. `Math.pow(2, NaN - 1)` is `NaN` and `Math.min(NaN, x)` is `NaN`, so a single
 * non-finite argument propagated straight through — and a `NaN` handed to
 * `setTimeout` is treated as **zero**, which is a reconnect that fires immediately
 * and repeatedly. A backoff that produces the storm it exists to prevent is worse
 * than no backoff, because it looks like it is working.
 *
 * The coercions are deliberately *toward* "wait a sensible amount" rather than
 * toward zero. A broken attempt counter means the caller's own state is already wrong;
 * answering with `baseMs` is one normal wait, and answering with zero would rejoin the
 * storm the broken counter already started.
 *
 * @param attempt  - 1-based reconnection attempt counter
 * @param baseMs   - base delay in milliseconds (e.g. 1000)
 * @param maxMs    - maximum delay cap in milliseconds (e.g. 30000)
 * @returns        delay in milliseconds, capped at `maxMs`, never `NaN`
 */
export function computeBackoff(attempt: number, baseMs: number, maxMs: number): number {
  const safeBase = finiteOr(baseMs, 0);
  const safeCap = finiteOr(maxMs, Number.POSITIVE_INFINITY);
  // A 1-based counter, so a non-positive or non-finite value becomes the first
  // attempt rather than an undefined one.
  const safeAttempt = Number.isFinite(attempt) ? Math.max(1, Math.floor(attempt)) : 1;
  const exponential = safeBase * Math.pow(2, safeAttempt - 1);
  const jitter = Math.random() * safeBase * 1.5;
  const total = exponential + jitter;
  // A cap of 0 is a legitimate request for "do not wait" and is honoured; a cap that
  // is negative or not a number is not, because it would make every delay negative.
  if (!Number.isFinite(safeCap)) return Number.isFinite(total) ? Math.max(0, total) : 0;
  return Math.max(0, Math.min(total, safeCap));
}

/** The value if it is a usable number, otherwise the fallback. */
function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}
