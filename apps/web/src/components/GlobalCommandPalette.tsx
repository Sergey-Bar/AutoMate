import { CommandPalette } from '@automate/ui';
import { useCommandStore, useCommandActions } from '../hooks/useCommandActions.js';
import { useNavigate } from '@tanstack/react-router';
import { useMemo } from 'react';

export function GlobalCommandPalette() {
  const actions = useCommandStore();
  const navigate = useNavigate();

  const builtInActions = useMemo(
    () => [
      {
        id: 'nav-dashboard',
        label: 'Go to MAIN',
        onSelect: () => void navigate({ to: '/dashboard' }),
      },
      {
        id: 'nav-runs',
        label: 'Go to Runs',
        onSelect: () => void navigate({ to: '/dashboard/runs' }),
      },
      // **No theme action.** The product ships one theme — dark — so there is
      // nothing to toggle, and a palette entry that does nothing is an
      // affordance the product cannot honour.
      // **No "Sign Out" action.** There is no session to end on an open install, and a
      // palette entry that navigated to a route which no longer exists would leave the
      // user on a dead link.
    ],
    [navigate],
  );

  useCommandActions(builtInActions);

  return <CommandPalette actions={actions} />;
}
