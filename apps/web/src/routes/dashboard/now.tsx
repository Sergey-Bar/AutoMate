import React from 'react';
import { createRoute, useNavigate } from '@tanstack/react-router';
import { Route as dashboardRoute } from '../dashboard.js';
import { NowPage, type NowSources } from '../../components/Now.js';
import { defaultApiClient } from '../../lib/api.js';
import { createHealthClient } from '../../lib/health-client.js';
import { createNotificationsClient } from '../../lib/notifications-client.js';

/** The landing page: what needs attention now. `/` redirects here. */
export const Route = createRoute({
  getParentRoute: () => dashboardRoute,
  path: '/now',
  component: function NowRoute() {
    const navigate = useNavigate();
    const sources = React.useMemo<NowSources>(() => {
      const health = createHealthClient();
      const notifications = createNotificationsClient();
      return {
        runs: () => defaultApiClient.getRuns(),
        portfolio: () => health.getPortfolio(),
        deliveries: () => notifications.listDeliveries(),
      };
    }, []);
    return <NowPage sources={sources} navigate={(to) => void navigate({ to })} />;
  },
});
