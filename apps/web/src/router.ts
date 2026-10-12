import { createElement } from 'react';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { Route as rootRoute } from './routes/__root.js';
import { Route as dashboardRoute } from './routes/dashboard.js';
import { Route as analyticsRoute } from './routes/dashboard/analytics.js';
import { Route as runsListRoute } from './routes/dashboard/index.js';
import { Route as runDetailRoute } from './routes/dashboard/run-detail.js';
import { Route as quarantineRoute } from './routes/dashboard/quarantine.js';
import { Route as todayRoute } from './routes/dashboard/today.js';
import { Route as toolsRoute } from './routes/dashboard/tools.js';
import { Route as insightsRoute } from './routes/dashboard/insights.js';
import { Route as scoreRoute } from './routes/dashboard/score.js';
import { FlakyRoute, GapsRoute, HollowRoute, StructureRoute } from './routes/dashboard/gaps.js';

const dashboardTree = dashboardRoute.addChildren([
  runsListRoute,
  runDetailRoute,
  analyticsRoute,
  quarantineRoute,
  // **The daily page, and it sits above the screens it reads from.** The cockpit
  // answers "what is the score"; today answers "what do I do", from the score
  // diff, the findings engine, the decision queue and the timeline. The order
  // here is the order the sidebar shows it in, and putting it first is the whole
  // point of F0.2.
  todayRoute,
  toolsRoute,
  insightsRoute,
  scoreRoute,
  GapsRoute,
  HollowRoute,
  FlakyRoute,
  StructureRoute,
]);

/**
 * Exported so `route-manifest.test.ts` can assert the manifest against the routes
 * that are actually registered.
 *
 * Keeping this private meant the manifest was only ever checked against itself:
 * `isApplicationPath` is defined in the module under test, so a test comparing the
 * manifest to it proves the manifest agrees with the manifest. A route could sit in
 * this tree while being absent from the manifest, and nothing would fail — which is
 * what happened to `/dashboard/quarantine` (ledger W-8).
 *
 * No index route. `/` is handled by `rootRoute`'s `beforeLoad`, which redirects
 * to the command center. A child declared with `path: '/'` made `/` match twice —
 * that child and the root — and a rendered redirect between two matching routes is
 * a cycle; see the comment in `routes/__root.tsx`.
 *
 * **No login route.** The install is open: one tenant, one operator, self-hosted,
 * and nothing behind this to authenticate *to* (ADR-006). The route and its
 * `AuthGuard` are gone rather than unreachable, so there is no second way back in.
 */
export const routeTree = rootRoute.addChildren([dashboardTree]);

export const router = createRouter({ routeTree });

export function MemoryRouter({
  initialEntries = ['/'],
}: {
  initialEntries?: string[];
} = {}) {
  const memoryRouter = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries }),
  });
  return createElement(RouterProvider, { router: memoryRouter, context: {} });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
