import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { useEmbeddedMode } from './useEmbeddedMode.js';

describe('useEmbeddedMode', () => {
  const originalWindow = globalThis.window;

  afterEach(() => {
    globalThis.window = originalWindow;
    vi.restoreAllMocks();
  });

  it('returns false when window.self === window.top (standalone)', () => {
    const mockWindow = { self: {}, top: {} };
    mockWindow.self = mockWindow;
    mockWindow.top = mockWindow;

    vi.stubGlobal('window', mockWindow);

    const { result } = renderHook(() => useEmbeddedMode());
    expect(result.current).toBe(false);
  });

  it('returns true when window.self !== window.top (embedded)', () => {
    const mockWindow = { self: {}, top: {} };
    vi.stubGlobal('window', mockWindow);

    const { result } = renderHook(() => useEmbeddedMode());
    expect(result.current).toBe(true);
  });

  it('returns true when accessing window.top throws an error (cross-origin)', () => {
    const mockWindow = { self: {} };
    Object.defineProperty(mockWindow, 'top', {
      get() {
        throw new Error('Cross-origin block');
      },
    });

    vi.stubGlobal('window', mockWindow);

    const { result } = renderHook(() => useEmbeddedMode());
    expect(result.current).toBe(true);
  });
});
