import { render, screen, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GlobalCommandPalette } from './GlobalCommandPalette.js';
import { commandStore } from '../hooks/useCommandActions.js';
import { ThemeProvider } from '../theme/ThemeProvider.js';

const mockNavigate = vi.fn();
// Mock the router and theme hooks
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
}));

describe('GlobalCommandPalette', () => {
  beforeEach(() => {
    commandStore.clear();
  });

  it('registers built-in actions on mount', () => {
    // The CommandPalette component inside is visually hidden unless opened by default
    // We can just assert that the store gets the registered actions
    render(
      <ThemeProvider>
        <GlobalCommandPalette />
      </ThemeProvider>
    );

    const actions = commandStore.getActions();
    expect(actions.length).toBeGreaterThan(0);

    // Check for some known actions
    const ids = actions.map(a => a.id);
    expect(ids).toContain('nav-dashboard');
    expect(ids).toContain('theme-toggle');
    expect(ids).toContain('auth-signout');
  });

  // Since CommandPalette listens for Cmd+K, we don't necessarily need to test the ui package's
  // internal handling, but we could mock it if needed. The prompt requires:
  // "New tests for: action registration, deregistration on unmount, shortcut binding (Cmd/Ctrl+K)"
  // The shortcut binding is actually within @automate/ui/CommandPalette, but let's test if it's there
  it('opens on Ctrl+K', () => {
    render(
      <ThemeProvider>
        <GlobalCommandPalette />
      </ThemeProvider>
    );

    // Initial state: not open (hidden)
    expect(screen.queryByPlaceholderText('Type a command or search...')).toBeNull();

    // Trigger shortcut
    act(() => {
      const event = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true });
      document.dispatchEvent(event);
    });

    // Now it should be visible
    expect(screen.queryByPlaceholderText('Type a command or search...')).toBeTruthy();
  });

  it('deregisters actions on unmount', () => {
    const { unmount } = render(
      <ThemeProvider>
        <GlobalCommandPalette />
      </ThemeProvider>
    );

    expect(commandStore.getActions().length).toBeGreaterThan(0);
    unmount();
    expect(commandStore.getActions().length).toBe(0);
  });

  it('nav-dashboard action calls navigate with /dashboard', () => {
    render(<ThemeProvider><GlobalCommandPalette /></ThemeProvider>);
    const action = commandStore.getActions().find(a => a.id === 'nav-dashboard');
    expect(action).toBeDefined();
    act(() => { action!.onSelect(); });
    expect(mockNavigate).toHaveBeenCalledWith({ to: '/dashboard' });
  });

  it('auth-signout action calls navigate with /login', () => {
    render(<ThemeProvider><GlobalCommandPalette /></ThemeProvider>);
    const action = commandStore.getActions().find(a => a.id === 'auth-signout');
    expect(action).toBeDefined();
    act(() => { action!.onSelect(); });
    expect(mockNavigate).toHaveBeenCalledWith({ to: '/login' });
  });

  it('theme-toggle action switches from non-dark theme to dark', () => {
    localStorage.removeItem('automate-theme'); // ensure 'system' default
    render(<ThemeProvider><GlobalCommandPalette /></ThemeProvider>);
    const action = commandStore.getActions().find(a => a.id === 'theme-toggle');
    expect(action).toBeDefined();
    act(() => { action!.onSelect(); });
    // theme was 'system' (not 'dark') → setTheme('dark')
    expect(localStorage.getItem('automate-theme')).toBe('dark');
  });

  it('theme-toggle action switches from dark to light', () => {
    localStorage.setItem('automate-theme', 'dark');
    render(<ThemeProvider><GlobalCommandPalette /></ThemeProvider>);
    const action = commandStore.getActions().find(a => a.id === 'theme-toggle');
    expect(action).toBeDefined();
    act(() => { action!.onSelect(); });
    // theme was 'dark' → setTheme('light')
    expect(localStorage.getItem('automate-theme')).toBe('light');
  });
});
