import { describe, expect, it, vi } from 'vitest';
import { startOutboxRetentionSweep } from './outbox-retention.js';

describe('outbox retention sweep', () => {
  it('purges on the interval without overlapping and stops cleanly', async () => {
    vi.useFakeTimers();
    const purgeExpired = vi.fn(async () => 1);
    const sweep = startOutboxRetentionSweep({ purgeExpired }, 1_000);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(purgeExpired).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(purgeExpired).toHaveBeenCalledTimes(2);
    sweep.stop();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(purgeExpired).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('keeps the sweep alive when a purge fails', async () => {
    // Liveness, which is why the failure is recorded rather than thrown: a sweep that
    // stops on the first error needs a human to restart it, and a transient database
    // blip should not need one.
    vi.useFakeTimers();
    const purgeExpired = vi.fn(async () => {
      throw new Error('database unavailable');
    });
    const sweep = startOutboxRetentionSweep({ purgeExpired }, 10);
    await vi.advanceTimersByTimeAsync(20);
    expect(purgeExpired).toHaveBeenCalledTimes(2);
    sweep.stop();
    vi.useRealTimers();
  });

  it('records the failure, so a dead sweep is distinguishable from a quiet one', async () => {
    // Ledger P-55 and Q-55, which are one defect filed twice. The swallowing is
    // deliberate — a purge that fails must not stop the next attempt — but that
    // `.catch` was the *only* place a failure could be observed, so a sweep failing
    // every minute for a week was indistinguishable from a sweep that had purged
    // nothing because there was nothing to purge. An operator reading the process had
    // no way to tell the two apart, and "no error" is exactly what a healthy
    // retention job looks like.
    vi.useFakeTimers();
    const purgeExpired = vi.fn(async () => {
      throw new Error('database unavailable');
    });
    const onError = vi.fn();
    const sweep = startOutboxRetentionSweep({ purgeExpired }, 10, onError);
    await vi.advanceTimersByTimeAsync(20);

    expect(sweep.sweeps()).toBe(2);
    expect(sweep.failures()).toBe(2);
    expect((sweep.lastError() as Error).message).toBe('database unavailable');
    // The failure also reaches the deployment's logger, not only the counters. A
    // signal nobody is told about is a counter in a process no one reads.
    expect(onError).toHaveBeenCalledTimes(2);
    sweep.stop();
    vi.useRealTimers();
  });

  it('reports a clean run as clean, so the counters mean something', async () => {
    // The counterweight, and the reason `lastError` is not a sticky flag. A failure
    // counter that also counted successes would be noise, and a `lastError` that
    // never clears would turn one transient blip into a permanently alarming
    // dashboard — which is its own way of making the signal ignored.
    vi.useFakeTimers();
    const purgeExpired = vi
      .fn<() => Promise<number>>()
      .mockRejectedValueOnce(new Error('database unavailable'))
      .mockResolvedValue(3);
    const sweep = startOutboxRetentionSweep({ purgeExpired }, 10, () => undefined);
    await vi.advanceTimersByTimeAsync(20);

    expect(sweep.sweeps()).toBe(2);
    expect(sweep.failures()).toBe(1);
    // The most recent sweep succeeded, so the last error is not the one before it.
    // "Is it broken right now?" is the question this exists to answer.
    expect(sweep.lastError()).toBeUndefined();
    sweep.stop();
    vi.useRealTimers();
  });
});
