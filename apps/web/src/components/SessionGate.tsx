import React from 'react';
import type { HealthClient } from '../lib/health-client.js';
import { SignIn } from './Access.js';

/**
 * Sign-in for the whole dashboard on an install that enforces access control.
 *
 * Until LAN mode only the portfolio, a repository and the Access page asked who was calling;
 * every other page loaded and then failed each request with a 401. This asks once, at the
 * root, and shows the one sign-in field when the answer is "nobody".
 *
 * **It fails open, on purpose, and that is safe.** The API is what enforces access: a page
 * shown to a caller with no role still gets 401 for every request it makes. So while the
 * answer is pending, or if `whoami` cannot be reached, the page renders as it always did —
 * the gate decides what is drawn, never what is allowed.
 */
export function SessionGate({
  health,
  bypass,
  children,
}: {
  health: HealthClient;
  /** A page that is its own credential exchange, such as pairing. */
  bypass: boolean;
  children: React.ReactNode;
}): React.ReactElement {
  const [needsSignIn, setNeedsSignIn] = React.useState(false);
  const [version, setVersion] = React.useState(0);
  React.useEffect(() => {
    if (bypass) return undefined;
    let live = true;
    health
      .whoami()
      .then((who) => {
        if (live) setNeedsSignIn(who.role === null);
      })
      .catch(() => {
        if (live) setNeedsSignIn(false);
      });
    return () => {
      live = false;
    };
  }, [health, bypass, version]);
  if (!bypass && needsSignIn) {
    return <SignIn health={health} onSignedIn={() => setVersion((value) => value + 1)} />;
  }
  return <>{children}</>;
}
