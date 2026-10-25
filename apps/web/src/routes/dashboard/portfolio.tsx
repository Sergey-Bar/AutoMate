import React from 'react';
import { createRoute } from '@tanstack/react-router';
import { Route as dashboardRoute } from '../dashboard.js';
import { Portfolio } from '../../components/Portfolio.js';
import { RepoHealth } from '../../components/RepoHealth.js';
import { createHealthClient } from '../../lib/health-client.js';
import { AccessGate, AccessPage } from '../../components/Access.js';

/** The landing page: every repository's grade, worst first. */
export const PortfolioRoute = createRoute({
  getParentRoute: () => dashboardRoute,
  path: '/portfolio',
  component: () => {
    const health = createHealthClient();
    return <AccessGate health={health}>{() => <Portfolio health={health} />}</AccessGate>;
  },
});

/** One repository's grade, its limiter, the seven dimensions and the findings behind them. */
export const RepoHealthRoute = createRoute({
  getParentRoute: () => dashboardRoute,
  path: '/repo/$projectId',
  component: () => {
    const { projectId } = RepoHealthRoute.useParams();
    const health = createHealthClient();
    return (
      <AccessGate health={health}>
        {() => <RepoHealth health={health} projectId={projectId} />}
      </AccessGate>
    );
  },
});

/** Access tokens: issue, list, revoke. */
export const AccessRoute = createRoute({
  getParentRoute: () => dashboardRoute,
  path: '/access',
  component: () => <AccessPage health={createHealthClient()} />,
});
