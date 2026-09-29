import { renderHook, act } from '@testing-library/react';
import { ThemeProvider, useTheme } from './ThemeProvider.js';
import React from 'react';

describe('ThemeProvider', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <ThemeProvider>{children}</ThemeProvider>
  );

  it('initializes with system theme if nothing in localStorage', () => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });

    const { result } = renderHook(() => useTheme(), { wrapper });
    expect(result.current.theme).toBe('system');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('initializes from localStorage', () => {
    localStorage.setItem('automate-theme', 'dark');
    const { result } = renderHook(() => useTheme(), { wrapper });
    expect(result.current.theme).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('updates localStorage and root attribute on theme change', () => {
    const { result } = renderHook(() => useTheme(), { wrapper });

    act(() => {
      result.current.setTheme('light');
    });

    expect(result.current.theme).toBe('light');
    expect(localStorage.getItem('automate-theme')).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('applies dark data-theme when system prefers dark', () => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: true,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });

    const { result } = renderHook(() => useTheme(), { wrapper });
    expect(result.current.theme).toBe('system');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('respects custom defaultTheme prop when no localStorage value', () => {
    const customWrapper = ({ children }: { children: React.ReactNode }) => (
      <ThemeProvider defaultTheme="dark">{children}</ThemeProvider>
    );
    const { result } = renderHook(() => useTheme(), { wrapper: customWrapper });
    expect(result.current.theme).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('reads from custom storageKey when provided', () => {
    localStorage.setItem('my-custom-key', 'dark');
    const customWrapper = ({ children }: { children: React.ReactNode }) => (
      <ThemeProvider storageKey="my-custom-key">{children}</ThemeProvider>
    );
    const { result } = renderHook(() => useTheme(), { wrapper: customWrapper });
    expect(result.current.theme).toBe('dark');
    localStorage.removeItem('my-custom-key');
  });

  it('writes to custom storageKey on setTheme', () => {
    const customWrapper = ({ children }: { children: React.ReactNode }) => (
      <ThemeProvider storageKey="custom-write-key">{children}</ThemeProvider>
    );
    const { result } = renderHook(() => useTheme(), { wrapper: customWrapper });
    act(() => {
      result.current.setTheme('light');
    });
    expect(localStorage.getItem('custom-write-key')).toBe('light');
    localStorage.removeItem('custom-write-key');
  });

  it('re-applies system theme on setTheme("system")', () => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    localStorage.setItem('automate-theme', 'dark');
    const { result } = renderHook(() => useTheme(), { wrapper });
    act(() => {
      result.current.setTheme('system');
    });
    expect(result.current.theme).toBe('system');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('defaults to light when window.matchMedia is not available (covers matchMedia falsy branch)', () => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: undefined,
    });
    const { result } = renderHook(() => useTheme(), { wrapper });
    expect(result.current.theme).toBe('system');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('follows an OS theme change while in system mode', () => {
    // The provider asked `matchMedia` once and returned. A reader who has not
    // chosen a theme — the default, and the only setting that promises to follow
    // the system — got the OS's answer at page load and nothing after it, so
    // switching the OS to dark at 6pm left them staring at a white page until they
    // reloaded. Nothing was wrong and nothing looked wrong (ledger W-9).
    const listeners = new Set<(event: MediaQueryListEvent) => void>();
    let matches = false;
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        get matches() {
          return matches;
        },
        media: query,
        onchange: null,
        addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
          listeners.add(listener);
        },
        removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
          listeners.delete(listener);
        },
        dispatchEvent: vi.fn(),
      })),
    });

    const { unmount } = renderHook(() => useTheme(), { wrapper });
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(listeners.size).toBe(1);

    act(() => {
      matches = true;
      for (const listener of listeners) {
        listener({ matches: true } as MediaQueryListEvent);
      }
    });

    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');

    // And back again, which is the direction nobody tests.
    act(() => {
      matches = false;
      for (const listener of listeners) {
        listener({ matches: false } as MediaQueryListEvent);
      }
    });
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');

    // Unsubscribing, so a provider that unmounts and remounts does not accumulate
    // listeners — each one keeps a closure alive for the life of the page.
    unmount();
    expect(listeners.size).toBe(0);
  });

  it('stops following the OS once a theme is chosen explicitly', () => {
    // An explicit choice overrides the system, so a later OS change must not undo
    // it. A provider that kept its listener would fight the reader.
    const listeners = new Set<(event: MediaQueryListEvent) => void>();
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
          listeners.add(listener);
        },
        removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
          listeners.delete(listener);
        },
        dispatchEvent: vi.fn(),
      })),
    });

    const { result } = renderHook(() => useTheme(), { wrapper });
    expect(listeners.size).toBe(1);

    act(() => {
      result.current.setTheme('light');
    });
    expect(listeners.size).toBe(0);

    act(() => {
      for (const listener of listeners) {
        listener({ matches: true } as MediaQueryListEvent);
      }
    });
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('useTheme throws when called outside a ThemeProvider (covers context === undefined branch)', () => {
    // With createContext<...>(undefined), calling useTheme without a Provider throws
    expect(() => renderHook(() => useTheme())).toThrow(
      'useTheme must be used within a ThemeProvider',
    );
  });
});
