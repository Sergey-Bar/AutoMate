import { createRouter } from '@tanstack/react-router';
import { Route as rootRoute } from './routes/__root.js';
import { Route as indexRoute } from './routes/index.js';
import { Route as dashboardRoute } from './routes/dashboard.js';
import { Route as analyticsRoute } from './routes/dashboard/analytics.js';
import { Route as runDetailRoute } from './routes/dashboard/run-detail.js';
import { Route as quarantineRoute } from './routes/dashboard/quarantine.js';
import { Route as flakyRoute } from './routes/dashboard/flaky.js';
import { Route as trendsRoute } from './routes/dashboard/trends.js';
import { Route as leaderboardsRoute } from './routes/dashboard/leaderboards.js';
import { Route as aiRoute } from './routes/ai.js';
import { Route as toolsRoute } from './routes/tools.js';
import { Route as integrationsRoute } from './routes/integrations.js';
import { Route as settingsRoute } from './routes/settings.js';
import { Route as adminRoute } from './routes/admin.js';
import { Route as automateRoute } from './routes/automate.js';
import { Route as automateIndexRoute } from './routes/automate/index.js';
import { Route as automateConversationRoute } from './routes/automate/$conversationId.js';
import { Route as automateConnectorsRoute } from './routes/automate/connectors.js';
import { Route as automateVaultRoute } from './routes/automate/vault.js';
import { Route as automateSchedulesRoute } from './routes/automate/schedules.js';
import { Route as webwrightRoute } from './routes/webwright.js';
import { Route as webwrightIndexRoute } from './routes/webwright/index.js';
import { Route as webwrightRunDetailRoute } from './routes/webwright/$runId.js';
import { Route as loginRoute } from './routes/login.js';
import { Route as onboardingRoute } from './routes/onboarding.js';

const dashboardTree = dashboardRoute.addChildren([
  analyticsRoute,
  runDetailRoute,
  quarantineRoute,
  flakyRoute,
  trendsRoute,
  leaderboardsRoute,
]);

const automateTree = automateRoute.addChildren([
  automateIndexRoute,
  automateConversationRoute,
  automateConnectorsRoute,
  automateVaultRoute,
  automateSchedulesRoute,
]);

const webwrightTree = webwrightRoute.addChildren([
  webwrightIndexRoute,
  webwrightRunDetailRoute,
]);

const routeTree = rootRoute.addChildren([
  indexRoute,
  dashboardTree,
  aiRoute,
  toolsRoute,
  integrationsRoute,
  settingsRoute,
  adminRoute,
  automateTree,
  webwrightTree,
  loginRoute,
  onboardingRoute,
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
