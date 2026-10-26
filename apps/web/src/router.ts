import { createElement } from 'react';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { Route as rootRoute } from './routes/__root.js';
import { Route as dashboardRoute } from './routes/dashboard.js';
import { Route as analyticsRoute } from './routes/dashboard/analytics.js';
import { Route as insightsRoute } from './routes/dashboard/insights.js';
import { Route as runsListRoute } from './routes/dashboard/index.js';
import { Route as runDetailRoute } from './routes/dashboard/run-detail.js';
import { Route as runnerRoute } from './routes/dashboard/runner.js';
import { Route as healthRoute } from './routes/dashboard/health.js';
import { Route as mapRoute } from './routes/dashboard/map.js';
import { Route as toolboxRoute } from './routes/dashboard/toolbox.js';
import { Route as quarantineRoute } from './routes/dashboard/quarantine.js';
import { Route as scoreRoute } from './routes/dashboard/score.js';
import { FlakyRoute, GapsRoute, HollowRoute, StructureRoute } from './routes/dashboard/gaps.js';
import {
  AccessRoute,
  PairRoute,
  PortfolioRoute,
  RepoHealthRoute,
} from './routes/dashboard/portfolio.js';
import { Route as reportsRoute } from './routes/dashboard/reports.js';
import { Route as nowRoute } from './routes/dashboard/now.js';
import {
  AgentsRoute,
  AiCodeRoute,
  DeliveryRoute,
  Repo360Route,
  SupplyChainRoute,
} from './routes/dashboard/scorecards.js';

const dashboardTree = dashboardRoute.addChildren([
  nowRoute,
  PortfolioRoute,
  RepoHealthRoute,
  Repo360Route,
  AccessRoute,
  PairRoute,
  reportsRoute,
  insightsRoute,
  runsListRoute,
  runDetailRoute,
  runnerRoute,
  healthRoute,
  mapRoute,
  toolboxRoute,
  analyticsRoute,
  quarantineRoute,
  scoreRoute,
  GapsRoute,
  HollowRoute,
  FlakyRoute,
  StructureRoute,
  SupplyChainRoute,
  DeliveryRoute,
  AiCodeRoute,
  AgentsRoute,
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
