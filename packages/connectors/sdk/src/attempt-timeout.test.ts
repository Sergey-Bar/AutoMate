import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeWithRetry } from './index.js';

/**
 * The per-attempt deadline `executeWithRetry` applies from a manifest's `timeoutMs`.
 *
 * Each case is about what the *operation* receives, because the signal is the only way
 * the deadline reaches a request: an adapter that ignored it would still compile.
 */

afterEach(() => {
  vi.useRealTimers();
});

/** An operation that settles only when its signal aborts, with the abort reason. */
function stalled(seen: Array<AbortSignal | undefined>) {
  return (signal?: AbortSignal) =>
    new Promise<never>((_resolve, reject) => {
      seen.push(signal);
      // As `fetch` does: an already-aborted signal rejects at once.
      if (signal?.aborted) {
        reject(signal.reason as Error);
        return;
      }
      signal?.addEventListener('abort', () => reject(signal.reason as Error), { once: true });
    });
}

describe('the attempt deadline', () => {
  it('hands the caller signal through untouched when no timeout is declared', async () => {
    const caller = new AbortController();
    const seen: Array<AbortSignal | undefined> = [];
    await executeWithRetry(
      (signal) => {
        seen.push(signal);
        return Promise.resolve('ok');
      },
      { retries: 0, signal: caller.signal },
    );
    expect(seen).toEqual([caller.signal]);
  });

  it('aborts an attempt that outlives the timeout, with a TimeoutError', async () => {
    vi.useFakeTimers();
    const seen: Array<AbortSignal | undefined> = [];
    const pending = executeWithRetry(stalled(seen), { retries: 0, attemptTimeoutMs: 50 });
    const outcome = expect(pending).rejects.toMatchObject({ name: 'TimeoutError' });
    await vi.advanceTimersByTimeAsync(50);
    await outcome;
    expect(seen[0]?.aborted).toBe(true);
  });

  it('aborts the attempt at once when the caller has already cancelled', async () => {
    const caller = new AbortController();
    caller.abort(new Error('caller gave up'));
    const seen: Array<AbortSignal | undefined> = [];
    await expect(
      executeWithRetry(stalled(seen), {
        retries: 0,
        signal: caller.signal,
        attemptTimeoutMs: 10_000,
      }),
    ).rejects.toThrow('caller gave up');
    expect(seen[0]?.aborted).toBe(true);
  });

  it('follows a caller that cancels while the attempt is in flight', async () => {
    const caller = new AbortController();
    const seen: Array<AbortSignal | undefined> = [];
    const pending = executeWithRetry(stalled(seen), {
      retries: 0,
      signal: caller.signal,
      attemptTimeoutMs: 10_000,
    });
    await Promise.resolve();
    caller.abort(new Error('cancelled mid-flight'));
    await expect(pending).rejects.toThrow('cancelled mid-flight');
  });

  it('leaves no timer behind once an attempt has settled', async () => {
    vi.useFakeTimers();
    await executeWithRetry(() => Promise.resolve('ok'), { retries: 0, attemptTimeoutMs: 10_000 });
    expect(vi.getTimerCount()).toBe(0);
  });
});
