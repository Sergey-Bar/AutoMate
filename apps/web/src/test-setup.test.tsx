/**
 * The client suite's own harness, tested.
 *
 * `test-setup.ts` is excluded from coverage because it holds no product behaviour,
 * which left the one thing it now does — raising `waitFor`'s default deadline — with
 * nothing asserting it. A `configure()` call that was reverted, or overridden by a
 * later `configure()`, would leave every `await waitFor(...)` in 27 files racing a
 * one-second deadline again, and nothing would fail until a loaded machine produced a
 * red that looked like a product bug.
 *
 * So this asserts the **behaviour** rather than the constant. Asserting
 * `ASYNC_UTIL_TIMEOUT_MS` would pass even if the `configure()` call were deleted
 * outright, which is the failure that matters; asserting that a slow-but-valid
 * condition is waited for cannot pass that way.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { describe, expect, it } from 'vitest';
import { ASYNC_UTIL_TIMEOUT_MS } from './test-setup.js';

/** Comfortably past testing-library's 1000 ms default, comfortably inside ours. */
const SETTLE_AFTER_MS = 1_400;

/**
 * Content that arrives *after* a delay, on a real timer.
 *
 * The first version of this fixture blocked synchronously inside `render`, which made
 * the test pass with the fix reverted: `render` did not return until the element
 * existed, so `waitFor` found its condition already true and never raced anything. It
 * looked like it proved the point and proved nothing — which is the specific way a
 * fail-before test is worthless, and the reason this one is a delayed effect rather
 * than a slow computation. Real timers, no fake clock: a `vi.useFakeTimers()` here
 * would let the assertion pass without the timeout ever being consulted.
 */
function ArrivesLate() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setReady(true), SETTLE_AFTER_MS);
    return () => clearTimeout(timer);
  }, []);
  return ready ? <span data-testid="late">ready</span> : <span data-testid="late">waiting</span>;
}

describe('the client test harness', () => {
  it('waits for a condition that takes longer than the old one-second default', async () => {
    render(<ArrivesLate />);
    // Asserted through the element's *settled* content, so the condition is false when
    // `waitFor` starts. Before `configure({ asyncUtilTimeout })` this failed at
    // 1000 ms and reported a passing repository as broken.
    await waitFor(() => expect(screen.getByTestId('late')).toHaveTextContent('ready'));
  });

  it('still fails a condition that never becomes true', async () => {
    // The other half, and the one that stops this from being a way of waiting forever.
    // A harness that cannot report a failure is worse than a flaky one.
    render(<div />);
    await expect(
      waitFor(() => expect(screen.getByTestId('never-arrives')).toBeInTheDocument(), {
        timeout: 200,
      }),
    ).rejects.toThrow();
  });

  it('declares a timeout that is generous but not the full test timeout', async () => {
    // 60 s would be `testTimeout` copied down, and would make a genuinely broken
    // selector slow to find. Asserted as a range rather than an exact number so a
    // reasonable retune does not need this rewritten.
    expect(ASYNC_UTIL_TIMEOUT_MS).toBeGreaterThan(1_000);
    expect(ASYNC_UTIL_TIMEOUT_MS).toBeLessThan(60_000);
  });
});
