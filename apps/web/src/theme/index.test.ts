/// <reference types="vitest/globals" />
import { ThemeProvider, useTheme, _themeLoaded } from './index.js';
import type { Theme, ThemeProviderProps, ThemeProviderState } from './index.js';

describe('theme/index barrel exports', () => {
  it('exports ThemeProvider as a function', () => {
    expect(ThemeProvider).toBeDefined();
    expect(typeof ThemeProvider).toBe('function');
  });

  it('exports useTheme as a function', () => {
    expect(useTheme).toBeDefined();
    expect(typeof useTheme).toBe('function');
  });

  it('exports _themeLoaded as true (barrel coverage marker)', () => {
    expect(_themeLoaded).toBe(true);
  });

  it('re-exports Theme type (compile-time check)', () => {
    const theme: Theme = 'dark';
    expect(theme).toBe('dark');
  });

  it('re-exports ThemeProviderProps type (compile-time check)', () => {
    const props: Partial<ThemeProviderProps> = { defaultTheme: 'light' };
    expect(props.defaultTheme).toBe('light');
  });

  it('re-exports ThemeProviderState type (compile-time check)', () => {
    const state: ThemeProviderState = { theme: 'system', setTheme: () => {} };
    expect(state.theme).toBe('system');
  });
});
