import { createRouter, createRootRoute, createRoute, lazyRouteComponent } from '@tanstack/react-router';

import { AppLayout } from './components/layout/AppLayout.js';

const rootRoute = createRootRoute({
  component: AppLayout,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: lazyRouteComponent(() => import('./routes/index.js')),
});

const chatRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/chat/$conversationId',
  component: lazyRouteComponent(() => import('./routes/index.js')),
});

const connectorsSettingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings/connectors',
  component: lazyRouteComponent(() => import('./routes/settings.connectors.js')),
});

const modelSettingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings/model',
  component: lazyRouteComponent(() => import('./routes/settings.model.js')),
});

const vaultSettingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings/vault',
  component: lazyRouteComponent(() => import('./routes/settings.vault.js')),
});

const sqlRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/sql',
  component: lazyRouteComponent(() => import('./routes/sql.js')),
});

const routeTree = rootRoute.addChildren([
  indexRoute, chatRoute, connectorsSettingsRoute, modelSettingsRoute, vaultSettingsRoute, sqlRoute,
]);

export const router = createRouter({ routeTree });
