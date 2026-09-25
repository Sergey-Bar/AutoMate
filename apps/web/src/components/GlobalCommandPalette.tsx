import { CommandPalette } from '@automate/ui';
import { useCommandStore, useCommandActions } from '../hooks/useCommandActions.js';
import { useTheme } from '../theme/ThemeProvider.js';
import { useAuth } from '../auth/useAuth.js';
import { useNavigate } from '@tanstack/react-router';
import { useMemo } from 'react';

export function GlobalCommandPalette() {
  const actions = useCommandStore();
  const { theme, setTheme } = useTheme();
  const { logout } = useAuth();
  const navigate = useNavigate();

  const builtInActions = useMemo(
    () => [
      {
        id: 'nav-dashboard',
        label: 'Go to Command Center',
        onSelect: () => void navigate({ to: '/dashboard' }),
      },
      {
        id: 'nav-runs',
        label: 'Go to Runs',
        onSelect: () => void navigate({ to: '/dashboard/runs' }),
      },
      {
        id: 'theme-toggle',
        label: 'Toggle Theme',
        onSelect: () => setTheme(theme === 'dark' ? 'light' : 'dark'),
      },
      {
        id: 'auth-signout',
        label: 'Sign Out',
        onSelect: () => {
          void logout().finally(() => void navigate({ to: '/login' }));
        },
      },
    ],
    [logout, navigate, setTheme, theme],
  );

  useCommandActions(builtInActions);

  return <CommandPalette actions={actions} />;
}
