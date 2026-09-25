/**
 * reconnect.ts
 *
 * Reconnection state type and exponential-backoff-with-jitter helper for
 * WebSocket clients.
 *
 * ## Usage
 *
 * ```ts
 * import { computeBackoff, type ReconnectState } from '@automate/realtime';
 *
 * let attempt = 0;
 * let state: ReconnectState = 'idle';
 *
 * function scheduleReconnect() {
 *   state = 'reconnecting';
 *   const delay = computeBackoff(++attempt, 1_000, 30_000);
 *   setTimeout(connect, delay);
 * }
 *
 * function onOpen() {
 *   state = 'connected';
 *   attempt = 0;
 * }
 *
 * function onClose() {
 *   if (attempt >= 10) { state = 'failed'; return; }
 *   scheduleReconnect();
 * }
 * ```
 *
 * ## Backoff formula
 *
 * ```
 * delay = min(baseMs * 2^(attempt-1) + rand(0, baseMs * 1.5), maxMs)
 * ```
 *
 * For `attempt=1, baseMs=1000, maxMs=30000` the result is in [1000, 2500].
 * For high attempt values the result is capped at `maxMs`.
 */

/** Connection lifecycle states for a managed WebSocket client */
export type ReconnectState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'failed';

/**
 * Compute the next reconnect delay using exponential backoff with jitter.
 *
 * @param attempt  - 1-based reconnection attempt counter
 * @param baseMs   - base delay in milliseconds (e.g. 1000)
 * @param maxMs    - maximum delay cap in milliseconds (e.g. 30000)
 * @returns        delay in milliseconds, capped at `maxMs`
 */
export function computeBackoff(attempt: number, baseMs: number, maxMs: number): number {
  const exponential = baseMs * Math.pow(2, attempt - 1);
  const jitter = Math.random() * baseMs * 1.5;
  return Math.min(exponential + jitter, maxMs);
}
