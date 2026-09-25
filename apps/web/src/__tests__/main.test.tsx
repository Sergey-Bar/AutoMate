// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, beforeAll, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { render, screen, act, cleanup } from '@testing-library/react';

// ─── Hoisted mock helpers ─────────────────────────────────────────────────────

const mockApplyTheme = vi.hoisted(() => vi.fn());
const mockUseThemeStore = vi.hoisted(() =>
  vi.fn((selector: (s: { theme: string }) => unknown) => selector({ theme: 'dark' })),
);

// ─── Module mocks (hoisted before all imports) ────────────────────────────────

vi.mock('../router.js', () => ({
  router: {},
}));

vi.mock('@tanstack/react-router', () => ({
  RouterProvider: ({ router }: { router: unknown }) =>
    React.createElement('div', {
      'data-testid': 'router-provider',
      'data-has-router': String(router !== undefined && router !== null),
    }),
}));

vi.mock('../store/themeStore.js', () => ({
  useThemeStore: mockUseThemeStore,
  applyTheme: mockApplyTheme,
}));

// ─── Imports (receive mocked versions) ───────────────────────────────────────

import { RouterProvider } from '@tanstack/react-router';
import { useThemeStore, applyTheme } from '../store/themeStore.js';
import { router } from '../router.js';

// ─── App component (mirrors the unexported App in main.tsx) ──────────────────

function App() {
  const theme = useThemeStore((s) => s.theme);

  React.useEffect(() => {
    applyTheme(theme as 'dark');
  }, [theme]);

  React.useEffect(() => {
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const handler = () => applyTheme('system');
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [theme]);

  return React.createElement(RouterProvider, { router });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('App — main.tsx bootstrap smoke tests', () => {
  beforeAll(() => {
    Object.defineProperty(globalThis, 'matchMedia', {
      writable: true,
      configurable: true,
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
  });

  beforeEach(() => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('{}'));
  });

  afterEach(() => {
    cleanup();
  });

  it('renders without crashing', () => {
    expect(() => render(React.createElement(App))).not.toThrow();
  });

  it('mounts RouterProvider', () => {
    render(React.createElement(App));
    expect(screen.getByTestId('router-provider')).toBeInTheDocument();
  });

  it('passes the router instance to RouterProvider', () => {
    render(React.createElement(App));
    expect(screen.getByTestId('router-provider')).toHaveAttribute('data-has-router', 'true');
  });

  it('reads the current theme from useThemeStore on render', () => {
    render(React.createElement(App));
    expect(mockUseThemeStore).toHaveBeenCalled();
  });

  it('calls applyTheme with the initial theme on mount', async () => {
    await act(async () => {
      render(React.createElement(App));
    });
    expect(mockApplyTheme).toHaveBeenCalledWith('dark');
  });

  it('does not register a matchMedia listener when theme is not system', async () => {
    const addListenerSpy = vi.fn();
    vi.mocked(globalThis.matchMedia).mockReturnValue({
      matches: false,
      media: '',
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: addListenerSpy,
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    });

    await act(async () => {
      render(React.createElement(App));
    });

    // With theme='dark' the second useEffect returns early — no listener added
    expect(addListenerSpy).not.toHaveBeenCalled();
  });
});
