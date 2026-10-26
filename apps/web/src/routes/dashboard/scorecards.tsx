import React from 'react';
import { createRoute } from '@tanstack/react-router';
import { Route as dashboardRoute } from '../dashboard.js';
import { AgentsPage } from '../../components/Agents.js';
import { AiCodePage } from '../../components/AiCode.js';
import { DeliveryPage } from '../../components/Delivery.js';
import { projectSearch } from '../../components/ProjectPage.js';
import { Repo360Page } from '../../components/Repo360.js';
import { SupplyChainPage } from '../../components/SupplyChain.js';
import { createAgentsClient } from '../../lib/agents-client.js';
import { createAiCodeClient } from '../../lib/ai-code-client.js';
import { createDeliveryClient } from '../../lib/delivery-client.js';
import { createHealthClient } from '../../lib/health-client.js';
import { createQaClient } from '../../lib/qa-client.js';
import { createSupplyChainClient } from '../../lib/supply-chain-client.js';

/**
 * The scorecard pages: supply chain, delivery, AI-written code, agents, and the 360 that
 * puts every scorecard beside the grade. Each per-project page takes `?project=` so a link
 * from the 360 or the portfolio opens the same repository.
 */
export const SupplyChainRoute = createRoute({
  getParentRoute: () => dashboardRoute,
  path: '/supply-chain',
  validateSearch: projectSearch,
  component: () => {
    const { project } = SupplyChainRoute.useSearch();
    return (
      <SupplyChainPage
        qa={createQaClient()}
        health={createHealthClient()}
        supplyChain={createSupplyChainClient()}
        projectId={project}
      />
    );
  },
});

export const DeliveryRoute = createRoute({
  getParentRoute: () => dashboardRoute,
  path: '/delivery',
  validateSearch: projectSearch,
  component: () => {
    const { project } = DeliveryRoute.useSearch();
    return (
      <DeliveryPage
        qa={createQaClient()}
        health={createHealthClient()}
        delivery={createDeliveryClient()}
        projectId={project}
      />
    );
  },
});

export const AiCodeRoute = createRoute({
  getParentRoute: () => dashboardRoute,
  path: '/ai-code',
  validateSearch: projectSearch,
  component: () => {
    const { project } = AiCodeRoute.useSearch();
    return (
      <AiCodePage
        qa={createQaClient()}
        health={createHealthClient()}
        aiCode={createAiCodeClient()}
        projectId={project}
      />
    );
  },
});

export const AgentsRoute = createRoute({
  getParentRoute: () => dashboardRoute,
  path: '/agents',
  validateSearch: projectSearch,
  component: () => {
    const { project } = AgentsRoute.useSearch();
    return (
      <AgentsPage
        qa={createQaClient()}
        health={createHealthClient()}
        agents={createAgentsClient()}
        projectId={project}
      />
    );
  },
});

export const Repo360Route = createRoute({
  getParentRoute: () => dashboardRoute,
  path: '/repo/$projectId/overview',
  component: () => {
    const { projectId } = Repo360Route.useParams();
    return (
      <Repo360Page
        projectId={projectId}
        clients={{
          qa: createQaClient(),
          health: createHealthClient(),
          delivery: createDeliveryClient(),
          aiCode: createAiCodeClient(),
          agents: createAgentsClient(),
          supplyChain: createSupplyChainClient(),
        }}
      />
    );
  },
});
