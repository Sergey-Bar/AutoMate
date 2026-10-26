import React from 'react';
import { createRoute } from '@tanstack/react-router';
import { Route as dashboardRoute } from '../dashboard.js';
import { Portfolio } from '../../components/Portfolio.js';
import { RepoHealth } from '../../components/RepoHealth.js';
import { createHealthClient } from '../../lib/health-client.js';
import { createAiCodeClient } from '../../lib/ai-code-client.js';
import { createDeliveryClient } from '../../lib/delivery-client.js';
import { AccessGate, AccessPage } from '../../components/Access.js';
import { PairPage } from '../../components/Pairing.js';

/** The landing page: every repository's grade, worst first. */
export const PortfolioRoute = createRoute({
  getParentRoute: () => dashboardRoute,
  path: '/portfolio',
  component: () => {
    const health = createHealthClient();
    return (
      <AccessGate health={health}>
        {() => (
          <Portfolio
            health={health}
            delivery={createDeliveryClient()}
            aiCode={createAiCodeClient()}
          />
        )}
      </AccessGate>
    );
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

/** Access tokens and devices: issue, pair, list, revoke. */
export const AccessRoute = createRoute({
  getParentRoute: () => dashboardRoute,
  path: '/access',
  component: () => <AccessPage health={createHealthClient()} />,
});

/** Where a pairing QR code lands. Spends the code, then opens the dashboard as that device. */
export const PairRoute = createRoute({
  getParentRoute: () => dashboardRoute,
  path: '/pair',
  validateSearch: (search: Record<string, unknown>): { code?: string } =>
    typeof search['code'] === 'string' || typeof search['code'] === 'number'
      ? { code: String(search['code']).replace(/\D/gu, '').slice(0, 6) }
      : {},
  component: () => {
    const { code } = PairRoute.useSearch();
    return (
      <PairPage
        health={createHealthClient()}
        initialCode={code ?? ''}
        onPaired={() => window.location.assign('/')}
      />
    );
  },
});
