export interface ExpiringRealtimeFeed {
  purgeExpired(now?: Date): Promise<number>;
}

/** What a running sweep can be asked about, without stopping it. */
export interface OutboxRetentionSweep {
  /** Stop scheduling further purges. */
  stop(): void;
  /** How many purges have been *attempted*, successfully or not. */
  sweeps(): number;
  /** How many of those attempts failed. */
  failures(): number;
  /**
   * The failure from the most recent sweep, or `undefined` when the most recent
   * sweep succeeded.
   *
   * Cleared on success on purpose. A sticky "last error" answers "did this ever
   * fail?", which is a question about history, while an operator watching a
   * retention job is asking "is it failing now?" — and a flag that latches makes
   * the second question unanswerable without also reading the timestamp.
   */
  lastError(): unknown;
}

/**
 * Start the periodic purge of expired outbox rows.
 *
 * The returned handle exists because the failure used to be swallowed by
 * `.catch(() => undefined)`, which was deliberate — liveness first, a purge that
 * throws must not stop the next attempt — but that `.catch` was the *only* place
 * the outcome could be observed. A sweep that had been failing every minute for a
 * week was therefore indistinguishable from a sweep with nothing to purge, and
 * those are opposite problems with opposite responses (ledger P-55, and Q-55,
 * which is the same absence seen from the observability side).
 *
 * The error also goes to `onError` so it reaches whatever logging the deployment
 * already has, rather than only being countable.
 */
export function startOutboxRetentionSweep(
  feed: ExpiringRealtimeFeed,
  intervalMs = 60_000,
  onError: (error: unknown) => void = (error) => {
    console.error('outbox retention sweep failed', error);
  },
): OutboxRetentionSweep {
  let running = false;
  let attempted = 0;
  let failed = 0;
  let lastFailure: unknown;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    attempted += 1;
    void feed
      .purgeExpired()
      .then(() => {
        lastFailure = undefined;
      })
      .catch((error: unknown) => {
        failed += 1;
        lastFailure = error;
        onError(error);
      })
      .finally(() => {
        running = false;
      });
  }, intervalMs);
  timer.unref?.();
  return {
    stop: () => clearInterval(timer),
    sweeps: () => attempted,
    failures: () => failed,
    lastError: () => lastFailure,
  };
}
