import { createElement } from 'react';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { Route as rootRoute } from './routes/__root.js';
import { Route as indexRoute } from './routes/index.js';
import { Route as dashboardRoute } from './routes/dashboard.js';
import { Route as analyticsRoute } from './routes/dashboard/analytics.js';
import { Route as runsListRoute } from './routes/dashboard/index.js';
import { Route as runDetailRoute } from './routes/dashboard/run-detail.js';
import { Route as quarantineRoute } from './routes/dashboard/quarantine.js';
import { Route as loginRoute } from './routes/login.js';

const dashboardTree = dashboardRoute.addChildren([
  runsListRoute,
  runDetailRoute,
  analyticsRoute,
  quarantineRoute,
]);

const routeTree = rootRoute.addChildren([indexRoute, dashboardTree, loginRoute]);

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
