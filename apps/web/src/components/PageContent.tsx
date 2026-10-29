import React from 'react';
import type { HealthClient } from '../lib/health-client.js';
import { PageGuide } from './PageGuide.js';
import { SessionGate } from './SessionGate.js';

/**
 * The page body: its guide and the page itself, both behind the sign-in gate.
 *
 * The guide sat outside the gate, so a signed-out caller saw "How to use Runs" above
 * the sign-in field for a page they could not open. It also stays outside
 * `[data-page]`: `j` and `k` walk the list rows inside that element, and the guide's
 * steps are a list.
 */
export function PageContent({
  health,
  pathname,
  children,
}: {
  health: HealthClient;
  pathname: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <SessionGate health={health} bypass={pathname === '/dashboard/pair'}>
      <PageGuide pathname={pathname} />
      <div data-page className="flex min-h-0 flex-1 flex-col">
        {children}
      </div>
    </SessionGate>
  );
}
