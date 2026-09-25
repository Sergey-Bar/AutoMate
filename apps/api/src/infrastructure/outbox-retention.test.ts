import { describe, expect, it, vi } from 'vitest';
import { startOutboxRetentionSweep } from './outbox-retention.js';

describe('outbox retention sweep', () => {
  it('purges on the interval without overlapping and stops cleanly', async () => {
    vi.useFakeTimers();
    const purgeExpired = vi.fn(async () => 1);
    const stop = startOutboxRetentionSweep({ purgeExpired }, 1_000);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(purgeExpired).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(purgeExpired).toHaveBeenCalledTimes(2);
    stop();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(purgeExpired).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('keeps the sweep alive when a purge fails', async () => {
    vi.useFakeTimers();
    const purgeExpired = vi.fn(async () => {
      throw new Error('database unavailable');
    });
    const stop = startOutboxRetentionSweep({ purgeExpired }, 10);
    await vi.advanceTimersByTimeAsync(20);
    expect(purgeExpired).toHaveBeenCalledTimes(2);
    stop();
    vi.useRealTimers();
  });
});
