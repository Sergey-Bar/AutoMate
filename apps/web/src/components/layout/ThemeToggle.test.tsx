/* eslint-disable @typescript-eslint/no-require-imports */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';
import type { ThemeMode } from '@/store/themeStore.js';

// Control the theme value returned by the store mock
let mockTheme: ThemeMode = 'dark';
const mockSetTheme = vi.fn((t: ThemeMode) => { mockTheme = t; });

// Mock themeStore so renderToString picks up the correct theme
vi.mock('@/store/themeStore.js', () => ({
  useThemeStore: vi.fn((selector: (s: { theme: ThemeMode; setTheme: typeof mockSetTheme }) => unknown) => {
    return selector({ theme: mockTheme, setTheme: mockSetTheme });
  }),
}));

// Mock lucide-react icons with createElement (hoisted factory pattern)
vi.mock('lucide-react', () => {
  const React = require('react') as typeof import('react');
  return {
    Sun: ({ size }: { size?: number }) => React.createElement('span', { 'data-testid': 'icon-sun', 'data-size': size }, 'sun'),
    Moon: ({ size }: { size?: number }) => React.createElement('span', { 'data-testid': 'icon-moon', 'data-size': size }, 'moon'),
    Monitor: ({ size }: { size?: number }) => React.createElement('span', { 'data-testid': 'icon-monitor', 'data-size': size }, 'monitor'),
  };
});

import { ThemeToggle } from './ThemeToggle.js';

beforeEach(() => {
  mockTheme = 'dark';
  mockSetTheme.mockClear();
});

describe('ThemeToggle', () => {
  it('renders a button', () => {
    const html = renderToString(<ThemeToggle />);
    expect(html).toContain('<button');
  });

  it('shows Moon icon when theme is dark', () => {
    mockTheme = 'dark';
    const html = renderToString(<ThemeToggle />);
    expect(html).toContain('data-testid="icon-moon"');
  });

  it('shows Sun icon when theme is light', () => {
    mockTheme = 'light';
    const html = renderToString(<ThemeToggle />);
    expect(html).toContain('data-testid="icon-sun"');
  });

  it('shows Monitor icon when theme is system', () => {
    mockTheme = 'system';
    const html = renderToString(<ThemeToggle />);
    expect(html).toContain('data-testid="icon-monitor"');
  });

  it('displays "Dark" label when theme is dark', () => {
    mockTheme = 'dark';
    const html = renderToString(<ThemeToggle />);
    expect(html).toContain('Dark');
  });

  it('displays "Light" label when theme is light', () => {
    mockTheme = 'light';
    const html = renderToString(<ThemeToggle />);
    expect(html).toContain('Light');
  });

  it('displays "System" label when theme is system', () => {
    mockTheme = 'system';
    const html = renderToString(<ThemeToggle />);
    expect(html).toContain('System');
  });

  it('has title attribute describing current theme', () => {
    mockTheme = 'dark';
    const html = renderToString(<ThemeToggle />);
    expect(html).toContain('Theme: Dark');
  });

  it('has aria-label for accessibility', () => {
    mockTheme = 'light';
    const html = renderToString(<ThemeToggle />);
    expect(html).toContain('Switch theme (current: Light)');
  });
});

// ─── cycle() handler coverage ────────────────────────────────────────────────
// Since renderToString doesn't fire DOM events, we invoke the component as a
// plain function and directly call the onClick prop to cover lines 14-15.

describe('ThemeToggle cycle() function', () => {
  it('cycles from dark → light when cycle() is called', () => {
    mockTheme = 'dark';
    // Call component as a function to get the React element with its props
    const element = ThemeToggle() as React.ReactElement<{ onClick: () => void }>;
    // Invoke the onClick (= cycle) directly
    element.props.onClick();
    expect(mockSetTheme).toHaveBeenCalledWith('light');
  });

  it('cycles from light → system when cycle() is called', () => {
    mockTheme = 'light';
    const element = ThemeToggle() as React.ReactElement<{ onClick: () => void }>;
    element.props.onClick();
    expect(mockSetTheme).toHaveBeenCalledWith('system');
  });

  it('cycles from system → dark when cycle() is called', () => {
    mockTheme = 'system';
    const element = ThemeToggle() as React.ReactElement<{ onClick: () => void }>;
    element.props.onClick();
    expect(mockSetTheme).toHaveBeenCalledWith('dark');
  });
});
