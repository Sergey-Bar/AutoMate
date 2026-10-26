import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type {
  AgentRuntimeReport,
  AiCodeReport,
  DeliveryReport,
  ProjectEvals,
  ProjectHealth,
  Scorecard,
} from '@automate/shared-contracts';
import type { AgentsClient } from '../lib/agents-client.js';
import type { AiCodeClient } from '../lib/ai-code-client.js';
import type { DeliveryClient } from '../lib/delivery-client.js';
import type { SupplyChainClient } from '../lib/supply-chain-client.js';
import {
  makeAiCodeReport,
  makeDeliveryReport,
  makeDimension,
  makeHealthDouble,
  makeProjectEvals,
  makeProjectHealth,
  makeQa,
  makeRuntimeReport,
  makeScorecard,
  pending,
  serverRefusal,
  TEST_PROJECT,
} from '../test-utils.js';
import { Repo360Page, type Repo360Clients } from './Repo360.js';

const SUPPLY_CARD = makeScorecard({
  id: 'supply-chain',
  title: 'Supply chain',
  dimension: 'supply-chain',
  status: 'fail',
  score: 0,
  cappedBy: 'fixable-critical',
  reasons: ['1 critical vulnerability with a fix available is open.'],
});
const TEST_CARD = makeScorecard({
  id: 'test-effectiveness',
  title: 'Test effectiveness',
  dimension: 'test-effectiveness',
  score: 74,
  cappedBy: 'mutation-score',
});

function clients(
  overrides: {
    health?: () => Promise<ProjectHealth>;
    delivery?: () => Promise<DeliveryReport>;
    aiCode?: () => Promise<AiCodeReport>;
    runtime?: () => Promise<AgentRuntimeReport>;
    evals?: () => Promise<ProjectEvals>;
    supplyChain?: () => Promise<Scorecard>;
    testEffectiveness?: () => Promise<Scorecard>;
  } = {},
): Repo360Clients {
  const delivery = {
    getReport: vi.fn(overrides.delivery ?? (async () => makeDeliveryReport())),
  } as unknown as DeliveryClient;
  const aiCode = {
    getReport: vi.fn(overrides.aiCode ?? (async () => makeAiCodeReport())),
  } as unknown as AiCodeClient;
  const agents = {
    getRuntime: vi.fn(overrides.runtime ?? (async () => makeRuntimeReport())),
    getEvals: vi.fn(overrides.evals ?? (async () => makeProjectEvals())),
  } as unknown as AgentsClient;
  return {
    qa: makeQa(),
    health: makeHealthDouble('viewer', {
      getHealth: vi.fn(overrides.health ?? (async () => makeProjectHealth())),
      getTestEffectiveness: vi.fn(overrides.testEffectiveness ?? (async () => TEST_CARD)),
    }),
    supplyChain: {
      getScorecard: vi.fn(overrides.supplyChain ?? (async () => SUPPLY_CARD)),
    } as unknown as SupplyChainClient,
    delivery,
    aiCode,
    agents,
  };
}

function renderPage(value: Repo360Clients = clients()) {
  return render(<Repo360Page clients={value} projectId={TEST_PROJECT.id} />);
}

describe('Repository 360', () => {
  it('shows the grade and links to it', async () => {
    const value = clients();
    renderPage(value);
    expect(await screen.findByTestId('repo-360-letter')).toHaveTextContent('C');
    const grade = screen.getByTestId('repo-360-grade');
    expect(grade).toHaveTextContent('74 / 100');
    expect(grade).toHaveTextContent('Limited by Security');
    expect(within(grade).getByRole('link', { name: 'Open the grade' })).toHaveAttribute(
      'href',
      '/dashboard/repo/project-1',
    );
    expect(value.health.getHealth).toHaveBeenCalledWith(TEST_PROJECT.id);
    expect(screen.getByRole('heading', { level: 1, name: 'Repository 360' })).toBeInTheDocument();
  });

  it('shows every scorecard, each linking to its own page', async () => {
    renderPage();
    const flow = await screen.findByTestId('scorecard-flow');
    expect(within(flow).getByRole('link', { name: /Open/u })).toHaveAttribute(
      'href',
      '/dashboard/delivery?project=project-1',
    );
    expect(screen.getByTestId('scorecard-delivery')).toBeInTheDocument();
    expect(
      within(await screen.findByTestId('scorecard-ai-code')).getByRole('link'),
    ).toHaveAttribute('href', '/dashboard/ai-code?project=project-1');
    const agentCards = await screen.findAllByTestId('scorecard-agent-quality');
    expect(agentCards).toHaveLength(2);
    for (const card of agentCards) {
      expect(within(card).getByRole('link')).toHaveAttribute(
        'href',
        '/dashboard/agents?project=project-1',
      );
    }
  });

  it('reads supply chain and test effectiveness from their own scorecards', async () => {
    const value = clients();
    renderPage(value);
    const supply = await screen.findByTestId('scorecard-supply-chain');
    expect(within(supply).getByRole('link')).toHaveAttribute(
      'href',
      '/dashboard/supply-chain?project=project-1',
    );
    expect(supply).toHaveAttribute('data-status', 'fail');
    const tests = await screen.findByTestId('scorecard-test-effectiveness');
    expect(within(tests).getByRole('link')).toHaveAttribute('href', '/dashboard/repo/project-1');
    expect(value.supplyChain.getScorecard).toHaveBeenCalledWith(TEST_PROJECT.id);
    expect(value.health.getTestEffectiveness).toHaveBeenCalledWith(TEST_PROJECT.id);
    // A failing supply-chain card's reason joins the one fix-next list.
    const list = await screen.findByTestId('repo-360-fix-next');
    await waitFor(() =>
      expect(list).toHaveTextContent('1 critical vulnerability with a fix available is open.'),
    );
    expect(screen.queryByTestId('repo-360-unserved-supply-chain')).toBeNull();
  });

  it('says why in place of a scorecard that could not be read', async () => {
    renderPage(
      clients({
        supplyChain: async () => {
          throw serverRefusal('No project project-1', 404);
        },
        testEffectiveness: () => pending<Scorecard>(),
      }),
    );
    expect(await screen.findByText(/No project project-1/u)).toBeInTheDocument();
    expect(screen.getByTestId('repo-360-test-effectiveness-loading')).toBeInTheDocument();
  });

  it('merges the grade’s fix-next with every failing scorecard’s reasons', async () => {
    renderPage();
    const list = await screen.findByTestId('repo-360-fix-next');
    await waitFor(() => expect(within(list).getAllByRole('listitem').length).toBeGreaterThan(2));
    const items = within(list).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Fix 2 SQL injection findings');
    expect(items[0]).toHaveTextContent('+6.5 pts');
    expect(within(items[0]!).getByRole('link')).toHaveAttribute(
      'href',
      'https://semgrep.dev/r/sqli',
    );
    expect(list).toHaveTextContent('Review latency 30 h is over the 24 h limit');
    expect(list).toHaveTextContent('refund-policy regressed from 100% to 33%');
  });

  it('keeps every other card when one read fails, and says why in its place', async () => {
    renderPage(
      clients({
        delivery: async () => {
          throw serverRefusal('Delivery is not configured', 409);
        },
        runtime: () => pending<AgentRuntimeReport>(),
      }),
    );
    expect(await screen.findByText(/Delivery is not configured/u)).toBeInTheDocument();
    expect(await screen.findByTestId('scorecard-ai-code')).toBeInTheDocument();
    expect(screen.getByTestId('repo-360-agent-runtime-loading')).toBeInTheDocument();
    // The list is still built from what did arrive.
    expect(await screen.findByText('Fix 2 SQL injection findings')).toBeInTheDocument();
  });

  it('shows an incomplete grade and its reason, and a grade it could not read', async () => {
    const health = makeProjectHealth({
      grade: {
        score: null,
        letter: null,
        incomplete: true,
        incompleteReason: 'Only Security is measured',
        cappedBy: null,
        fixNext: [],
      },
    });
    const { unmount } = renderPage(clients({ health: async () => health }));
    expect(await screen.findByTestId('repo-360-letter')).toHaveTextContent('—');
    expect(screen.getByTestId('repo-360-grade')).toHaveTextContent('incomplete');
    expect(screen.getByTestId('repo-360-grade')).toHaveTextContent('Only Security is measured');
    unmount();
    renderPage(
      clients({
        health: async () => {
          throw serverRefusal('No project project-1', 404);
        },
      }),
    );
    expect(await screen.findByTestId('repo-360-grade-error')).toHaveTextContent(
      'No project project-1',
    );
  });

  it('says when there is nothing to fix, and when no eval has reported', async () => {
    const health = makeProjectHealth({ grade: { fixNext: [] } });
    const passing = <T extends { status: string; reasons: readonly string[] }>(card: T): T => ({
      ...card,
      status: 'pass',
      reasons: [],
    });
    const delivery = makeDeliveryReport();
    renderPage(
      clients({
        health: async () => ({
          ...health,
          grade: {
            ...health.grade,
            dimensions: health.grade.dimensions.map((entry) =>
              entry.dimension === 'supply-chain'
                ? makeDimension({ dimension: 'supply-chain' })
                : entry,
            ),
          },
        }),
        delivery: async () => ({
          ...delivery,
          dora: passing(delivery.dora),
          flow: passing(delivery.flow),
        }),
        evals: async () => makeProjectEvals({ suites: [], runs: [] }),
        supplyChain: async () => passing(SUPPLY_CARD),
      }),
    );
    expect(
      await screen.findByText('No evals scorecard: nothing has reported.'),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId('repo-360-fix-next')).toHaveTextContent('Nothing to fix'),
    );
    expect(screen.getByTestId('scorecard-supply-chain')).toHaveAttribute('data-status', 'pass');
  });

  it('says it is still reading before anything arrives', async () => {
    renderPage(
      clients({
        health: () => pending<ProjectHealth>(),
        delivery: () => pending<DeliveryReport>(),
        aiCode: () => pending<AiCodeReport>(),
        runtime: () => pending<AgentRuntimeReport>(),
        evals: () => pending<ProjectEvals>(),
        supplyChain: () => pending<Scorecard>(),
        testEffectiveness: () => pending<Scorecard>(),
      }),
    );
    expect(await screen.findByTestId('repo-360-fix-next')).toHaveTextContent(
      'Reading the grade and the scorecards',
    );
    expect(screen.getByTestId('repo-360-supply-chain-loading')).toBeInTheDocument();
  });
});
