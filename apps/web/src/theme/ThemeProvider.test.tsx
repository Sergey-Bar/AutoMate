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

  it('is always dark, with no system fallback', () => {
    const { result } = renderHook(() => useTheme(), { wrapper });
    expect(result.current.theme).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('writes dark to localStorage', () => {
    renderHook(() => useTheme(), { wrapper });
    expect(localStorage.getItem('automate-theme')).toBe('dark');
  });

  it('setTheme is a no-op, because there is only one theme', () => {
    const { result } = renderHook(() => useTheme(), { wrapper });
    act(() => {
      result.current.setTheme();
    });
    expect(result.current.theme).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('reads from custom storageKey when provided', () => {
    const customWrapper = ({ children }: { children: React.ReactNode }) => (
      <ThemeProvider storageKey="my-custom-key">{children}</ThemeProvider>
    );
    renderHook(() => useTheme(), { wrapper: customWrapper });
    expect(localStorage.getItem('my-custom-key')).toBe('dark');
    localStorage.removeItem('my-custom-key');
  });

  it('useTheme throws when called outside a ThemeProvider (covers context === undefined branch)', () => {
    expect(() => renderHook(() => useTheme())).toThrow(
      'useTheme must be used within a ThemeProvider',
    );
  });
});
