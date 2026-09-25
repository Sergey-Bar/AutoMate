import React from 'react';
import { Link, useRouterState, useNavigate } from '@tanstack/react-router';
import { Button } from '@automate/ui';
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
  ];

  const handleLogout = async () => {
    await logout();
    void navigate({ to: '/login' });
  };

  return (
    <nav data-testid="nav-bar" style={{ display: 'flex', gap: '8px', padding: '16px', borderBottom: '1px solid #ccc', alignItems: 'center', justifyContent: 'space-between' }}>
      <div style={{ display: 'flex', gap: '8px' }}>
        {links.map((link) => (
          <Link key={link.to} to={link.to}>
            <Button variant={currentPath.startsWith(link.to) ? 'default' : 'outline'}>
              {link.label}
            </Button>
          </Link>
        ))}
      </div>
      <div style={{ display: 'flex', gap: '8px' }}>
        <Button
          variant="ghost"
          data-testid="theme-toggle"
          aria-label="Toggle theme"
          onClick={() => { const themes = ['light', 'dark', 'system'] as const; const cur = themes.indexOf(theme as typeof themes[number]); setTheme(themes[(cur + 1) % themes.length]); }}
        >
          {theme === 'dark' ? '🌙' : theme === 'light' ? '☀️' : '🖥️'}
        </Button>
        {isAuthenticated && (
          <Button
            variant="outline"
            data-testid="logout-button"
            onClick={() => { void handleLogout(); }}
          >
            Logout
          </Button>
        )}
      </div>
    </nav>
  );
}
