import { CommandPalette } from '@automate/ui';
import { useCommandStore, useCommandActions } from '../hooks/useCommandActions.js';
import { useTheme } from '../theme/ThemeProvider.js';
import { useNavigate } from '@tanstack/react-router';
import { useMemo } from 'react';

export function GlobalCommandPalette() {
  const actions = useCommandStore();
  const { theme, setTheme } = useTheme();
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
      // **No "Sign Out" action.** There is no session to end on an open install, and a
      // palette entry that navigated to a route which no longer exists would leave the
      // user on a dead link.
    ],
    [navigate, setTheme, theme],
  );

  useCommandActions(builtInActions);

  return <CommandPalette actions={actions} />;
}
