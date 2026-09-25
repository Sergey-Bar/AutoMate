import { createRouter } from '@tanstack/react-router';
import { Route as rootRoute } from './routes/__root.js';
import { Route as indexRoute } from './routes/index.js';
import { Route as dashboardRoute } from './routes/dashboard.js';
import { Route as analyticsRoute } from './routes/dashboard/analytics.js';
import { Route as runDetailRoute } from './routes/dashboard/run-detail.js';
import { Route as quarantineRoute } from './routes/dashboard/quarantine.js';
import { Route as loginRoute } from './routes/login.js';
import { Route as reportingRunRoute } from './routes/reporting.js';

const dashboardTree = dashboardRoute.addChildren([analyticsRoute, runDetailRoute, quarantineRoute]);

const routeTree = rootRoute.addChildren([indexRoute, dashboardTree, reportingRunRoute, loginRoute]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
