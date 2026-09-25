/// <reference types="vitest" />
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useDebounce } from '../useDebounce';

describe('useDebounce', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns initial value immediately', () => {
    const { result } = renderHook(() => useDebounce('alpha', 150));
    expect(result.current).toBe('alpha');
  });

  it('updates value after delay', () => {
    const { result, rerender } = renderHook(
      ({ value, delay }) => useDebounce(value, delay),
      { initialProps: { value: 'alpha', delay: 150 } },
    );

    rerender({ value: 'beta', delay: 150 });
    expect(result.current).toBe('alpha');

    act(() => {
      vi.advanceTimersByTime(149);
    });
    expect(result.current).toBe('alpha');

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe('beta');
  });

  it('resets timer on rapid changes and only emits last value', () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebounce(value, 200),
      { initialProps: { value: 'a' } },
    );

    rerender({ value: 'ab' });
    act(() => {
      vi.advanceTimersByTime(120);
    });
    rerender({ value: 'abc' });
    act(() => {
      vi.advanceTimersByTime(120);
    });

    expect(result.current).toBe('a');

    act(() => {
      vi.advanceTimersByTime(80);
    });
    expect(result.current).toBe('abc');
  });

  it('respects custom delay values', () => {
    const { result, rerender } = renderHook(
      ({ value, delay }) => useDebounce(value, delay),
      { initialProps: { value: 1, delay: 400 } },
    );

    rerender({ value: 2, delay: 400 });
    act(() => {
      vi.advanceTimersByTime(399);
    });
    expect(result.current).toBe(1);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe(2);
  });

  it('cleans up pending timer on unmount', () => {
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
    const { rerender, unmount } = renderHook(
      ({ value }) => useDebounce(value, 250),
      { initialProps: { value: 'start' } },
    );

    rerender({ value: 'next' });
    unmount();

    expect(clearTimeoutSpy).toHaveBeenCalled();
  });
});
