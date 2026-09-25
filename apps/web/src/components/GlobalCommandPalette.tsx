import { CommandPalette } from '@automate/ui';
import { useCommandStore, useCommandActions } from '../hooks/useCommandActions.js';
import { useTheme } from '../theme/ThemeProvider.js';
import { useNavigate } from '@tanstack/react-router';
import { useMemo } from 'react';

export function GlobalCommandPalette() {
  const actions = useCommandStore();
  const { theme, setTheme } = useTheme();
  const navigate = useNavigate();

  // Built-in actions
  const builtInActions = useMemo(() => [
    {
      id: 'nav-dashboard',
      label: 'Go to Dashboard',
      onSelect: () => navigate({ to: '/dashboard' })
    },
    {
      id: 'nav-automate',
      label: 'Go to Automate',
      onSelect: () => navigate({ to: '/automate' })
    },
    {
      id: 'nav-webwright',
      label: 'Go to Webwright',
      onSelect: () => navigate({ to: '/webwright' })
    },
    {
      id: 'theme-toggle',
      label: 'Toggle Theme',
      onSelect: () => setTheme(theme === 'dark' ? 'light' : 'dark')
    },
    {
      id: 'settings-open',
      label: 'Open Settings',
      onSelect: () => navigate({ to: '/settings' })
    },
    {
      id: 'auth-signout',
      label: 'Sign Out',
      onSelect: () => {
        // Sign out logic
        navigate({ to: '/login' });
      }
    }
  ], [navigate, theme, setTheme]);

  useCommandActions(builtInActions);

  return <CommandPalette actions={actions} />;
}