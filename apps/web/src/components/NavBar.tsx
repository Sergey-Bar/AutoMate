import React from 'react';
import { Link, useRouterState, useNavigate } from '@tanstack/react-router';
import { useAuth } from '../auth/useAuth.js';
import { useTheme } from '../theme/ThemeProvider.js';

export function NavBar() {
  const routerState = useRouterState();
  const navigate = useNavigate();
  const currentPath = routerState.location.pathname;
  const { logout, isAuthenticated } = useAuth();
  const { theme, setTheme } = useTheme();

  const links = [
    { to: '/dashboard', label: 'Dashboard' },
    { to: '/ai', label: 'AI' },
    { to: '/tools', label: 'Tools' },
    { to: '/integrations', label: 'Integrations' },
    { to: '/settings', label: 'Settings' },
  ];

  const handleLogout = async () => {
    await logout();
    void navigate({ to: '/login' });
  };

  return (
    <nav data-testid="nav-bar" className="app-navbar">
      <div className="app-navbar-links" aria-label="Main navigation">
        <span className="app-navbar-brand">Automate</span>
        {links.map((link) => (
          <Link
            key={link.to}
            to={link.to}
            className={currentPath.startsWith(link.to) ? 'nav-chip nav-chip-active' : 'nav-chip'}
          >
            {link.label}
          </Link>
        ))}
      </div>
      <div className="app-navbar-actions">
        <button
          type="button"
          className="action-button action-button-ghost"
          data-testid="theme-toggle"
          aria-label="Toggle theme"
          onClick={() => { const themes = ['light', 'dark', 'system'] as const; const cur = themes.indexOf(theme as typeof themes[number]); setTheme(themes[(cur + 1) % themes.length]); }}
        >
          {theme === 'dark' ? '🌙' : theme === 'light' ? '☀️' : '🖥️'}
        </button>
        {isAuthenticated && (
          <button
            type="button"
            className="action-button action-button-danger"
            data-testid="logout-button"
            onClick={() => { void handleLogout(); }}
          >
            Logout
          </button>
        )}
      </div>
    </nav>
  );
}
