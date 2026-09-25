import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GlobalCommandPalette } from './GlobalCommandPalette.js';
import { commandStore } from '../hooks/useCommandActions.js';
import { ThemeProvider } from '../theme/ThemeProvider.js';
import { resetAuthState } from '../auth/useAuth.js';

const mockNavigate = vi.fn();

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
}));

describe('GlobalCommandPalette', () => {
  beforeEach(() => {
    commandStore.clear();
    mockNavigate.mockClear();
    localStorage.clear();
    resetAuthState();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('registers canonical built-in actions on mount', () => {
    render(
      <ThemeProvider>
        <GlobalCommandPalette />
      </ThemeProvider>,
    );
    const ids = commandStore.getActions().map((action) => action.id);
    expect(ids).toEqual(
      expect.arrayContaining(['nav-dashboard', 'nav-runs', 'theme-toggle', 'auth-signout']),
    );
  });

  it('opens on Ctrl+K', () => {
    render(
      <ThemeProvider>
        <GlobalCommandPalette />
      </ThemeProvider>,
    );
    expect(screen.queryByPlaceholderText('Type a command or search...')).toBeNull();
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));
    });
    expect(screen.queryByPlaceholderText('Type a command or search...')).toBeTruthy();
  });

  it('deregisters actions on unmount', () => {
    const { unmount } = render(
      <ThemeProvider>
        <GlobalCommandPalette />
      </ThemeProvider>,
    );
    expect(commandStore.getActions().length).toBeGreaterThan(0);
    unmount();
    expect(commandStore.getActions()).toHaveLength(0);
  });

  it('navigates to the command center and run list', () => {
    render(
      <ThemeProvider>
        <GlobalCommandPalette />
      </ThemeProvider>,
    );
    act(() => {
      commandStore
        .getActions()
        .find((action) => action.id === 'nav-dashboard')
        ?.onSelect();
      commandStore
        .getActions()
        .find((action) => action.id === 'nav-runs')
        ?.onSelect();
    });
    expect(mockNavigate).toHaveBeenCalledWith({ to: '/dashboard' });
    expect(mockNavigate).toHaveBeenCalledWith({ to: '/dashboard/runs' });
  });

  it('logs out before navigating away', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    render(
      <ThemeProvider>
        <GlobalCommandPalette />
      </ThemeProvider>,
    );
    act(() => {
      commandStore
        .getActions()
        .find((action) => action.id === 'auth-signout')
        ?.onSelect();
    });
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith({ to: '/login' }));
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/auth/logout',
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    );
  });

  it('toggles theme from system to dark', () => {
    render(
      <ThemeProvider>
        <GlobalCommandPalette />
      </ThemeProvider>,
    );
    act(() => {
      commandStore
        .getActions()
        .find((action) => action.id === 'theme-toggle')
        ?.onSelect();
    });
    expect(localStorage.getItem('automate-theme')).toBe('dark');
  });

  it('toggles theme from dark to light', () => {
    localStorage.setItem('automate-theme', 'dark');
    render(
      <ThemeProvider>
        <GlobalCommandPalette />
      </ThemeProvider>,
    );
    act(() => {
      commandStore
        .getActions()
        .find((action) => action.id === 'theme-toggle')
        ?.onSelect();
    });
    expect(localStorage.getItem('automate-theme')).toBe('light');
  });
});
