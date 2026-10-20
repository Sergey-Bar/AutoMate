import { RunnerApiError } from './protocol.js';

export interface WaitOptions {
  /** How long to keep trying before giving up with the last connection error. */
  timeoutMs: number;
  /** The pause between attempts. */
  intervalMs: number;
  /** Called before each wait, so a supervisor's log says what the process is doing. */
  onWait?: (error: unknown) => void;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => number;
}

/**
 * Run `attempt` until the API answers, treating only "nothing is listening" as worth waiting for.
 *
 * A runner started by `pnpm dev:all` or `docker compose up` races the API it registers with, and
 * before this a refused connection on the first call ended the process with `TypeError: fetch
 * failed`, which under a process supervisor took the whole stack down with it. An answer from the
 * API is never retried: a wrong registration secret or a taken runner id will not improve by
 * waiting, and retrying them would only hide the misconfiguration for a minute.
 */
export async function whileUnreachable<T>(
  attempt: () => Promise<T>,
  options: WaitOptions,
): Promise<T> {
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));
  const now = options.now ?? Date.now;
  const deadline = now() + options.timeoutMs;
  for (;;) {
    try {
      return await attempt();
    } catch (error) {
      if (error instanceof RunnerApiError || !isConnectionFailure(error) || now() >= deadline) {
        throw error;
      }
      options.onWait?.(error);
      await sleep(options.intervalMs);
    }
  }
}

/** `fetch` rejects with a `TypeError` when the connection cannot be made, and with an abort on a timeout. */
function isConnectionFailure(error: unknown): boolean {
  return (
    error instanceof TypeError ||
    (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError'))
  );
}
