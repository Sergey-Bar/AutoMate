import { CommandPalette } from '@automate/ui';
import { useCommandStore, useCommandActions } from '../hooks/useCommandActions.js';
import { useTheme } from '../theme/ThemeProvider.js';
import { usePreferences } from '../theme/preferences.js';
import { useNavigate } from '@tanstack/react-router';
import { useMemo } from 'react';
import { visibleRoutes } from '../route-manifest.js';

export function GlobalCommandPalette() {
  const actions = useCommandStore();
  const { theme, setTheme } = useTheme();
  const { preferences, update } = usePreferences();
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
      {
        id: 'focus-toggle',
        label: preferences.focus ? 'Leave focus mode' : 'Focus mode',
        onSelect: () => update({ focus: !preferences.focus }),
      },
      {
        id: 'density-toggle',
        label: preferences.density === 'compact' ? 'Comfortable density' : 'Compact density',
        onSelect: () =>
          update({ density: preferences.density === 'compact' ? 'comfortable' : 'compact' }),
      },
      {
        id: 'motion-toggle',
        label: preferences.motion === 'reduced' ? 'Full motion' : 'Reduce motion',
        onSelect: () => update({ motion: preferences.motion === 'reduced' ? 'full' : 'reduced' }),
      },
      // **No "Sign Out" action.** There is no session to end on an open install, and a
      // palette entry that navigated to a route which no longer exists would leave the
      // user on a dead link.
    ],
    [navigate, setTheme, theme, preferences, update],
  );

  useCommandActions(builtInActions);

  return <CommandPalette actions={actions} />;
}
