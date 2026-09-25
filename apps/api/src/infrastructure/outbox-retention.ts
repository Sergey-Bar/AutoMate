export interface ExpiringRealtimeFeed {
  purgeExpired(now?: Date): Promise<number>;
}

export function startOutboxRetentionSweep(
  feed: ExpiringRealtimeFeed,
  intervalMs = 60_000,
): () => void {
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    void feed
      .purgeExpired()
      .catch(() => undefined)
      .finally(() => {
        running = false;
      });
  }, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
