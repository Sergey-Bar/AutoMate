import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useRequestLifecycle } from './use-request-lifecycle.js';

describe('useRequestLifecycle', () => {
  it('aborts the previous request when a new one begins', () => {
    const { result } = renderHook(() => useRequestLifecycle());

    let first!: AbortSignal;
    let second!: AbortSignal;
    act(() => {
      first = result.current.begin();
      second = result.current.begin();
    });

    expect(first.aborted).toBe(true);
    expect(second.aborted).toBe(false);
  });

  it('aborts the live request on cancelAll and leaves nothing in flight', () => {
    const { result } = renderHook(() => useRequestLifecycle());

    let signal!: AbortSignal;
    act(() => {
      signal = result.current.begin();
    });
    act(() => {
      result.current.cancelAll();
    });

    expect(signal.aborted).toBe(true);
  });

  it('is safe to cancel with nothing in flight, and to begin after cancelling', () => {
    const { result } = renderHook(() => useRequestLifecycle());

    act(() => {
      result.current.cancelAll();
      result.current.cancelAll();
    });

    let signal!: AbortSignal;
    act(() => {
      signal = result.current.begin();
    });
    expect(signal.aborted).toBe(false);
  });

  it('gives a fresh controller to every request, never a reused one', () => {
    const { result } = renderHook(() => useRequestLifecycle());

    const signals: AbortSignal[] = [];
    act(() => {
      signals.push(result.current.begin(), result.current.begin());
    });

    expect(signals[0]).not.toBe(signals[1]);
  });
});
