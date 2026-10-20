import { CommandPalette } from '@automate/ui';
import { useCommandStore, useCommandActions } from '../hooks/useCommandActions.js';
import { useTheme } from '../theme/ThemeProvider.js';
import { useNavigate } from '@tanstack/react-router';
import { useMemo } from 'react';
import { visibleRoutes } from '../route-manifest.js';

export function GlobalCommandPalette() {
  const actions = useCommandStore();
  const { theme, setTheme } = useTheme();
  const navigate = useNavigate();

  // One entry per visible route, read from the manifest, so a screen added to the
  // navigation bar is in the palette too rather than in one and not the other.
  const builtInActions = useMemo(
    () => [
      ...visibleRoutes.map((route) => ({
        id: `nav-${route.id}`,
        label: `Go to ${route.label}`,
        onSelect: () => void navigate({ to: route.path }),
      })),
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
