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
      value: vi.fn().mockImplementation(query => ({
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

  it('useTheme throws when called outside a ThemeProvider (covers context === undefined branch)', () => {
    // With createContext<...>(undefined), calling useTheme without a Provider throws
    expect(() => renderHook(() => useTheme())).toThrow('useTheme must be used within a ThemeProvider');
  });
});
