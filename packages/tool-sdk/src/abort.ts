import { ToolCancelledError, ToolTimeoutError } from './errors.js';

/** What an aborted signal means: the deadline fired, or the caller gave up. */
function abortError(signal: AbortSignal): Error {
  const reason: unknown = signal.reason;
  if (reason instanceof DOMException && reason.name === 'TimeoutError') {
    return new ToolTimeoutError(reason.message);
  }
  return new ToolCancelledError(undefined, { cause: reason });
}

/**
 * Settle with `work`, or with the abort, whichever comes first.
 *
 * `executeWithRetry` hands each attempt a signal that fires on the deadline, but a signal
 * only helps an adapter that listens to it. An adapter that awaits a child process and never
 * looks at its signal would hold the operation forever, so the deadline is enforced here
 * rather than requested.
 *
 * `work` keeps a handler for as long as it is pending, so a tool that fails after the race is
 * lost does not become an unhandled rejection.
 */
export function raceAbort<T>(work: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (signal === undefined) return work;
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(abortError(signal));
    if (signal.aborted) {
      work.catch(() => undefined);
      onAbort();
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}
