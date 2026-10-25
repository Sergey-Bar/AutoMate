import React from 'react';
import { createRoute } from '@tanstack/react-router';
import { Route as dashboardRoute } from '../dashboard.js';
import { NotificationsPage } from '../../components/Notifications.js';
import { createNotificationsClient } from '../../lib/notifications-client.js';

/** Scheduled reports: channels, schedules, the preview and the delivery history. */
export const Route = createRoute({
  getParentRoute: () => dashboardRoute,
  path: '/reports',
  component: function ReportsRoute() {
    const client = React.useMemo(() => createNotificationsClient(), []);
    return <NotificationsPage client={client} />;
  },
});
