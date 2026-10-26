import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { PortfolioAiCode, PortfolioDelivery } from '@automate/shared-contracts';
import type { AiCodeClient } from '../lib/ai-code-client.js';
import type { DeliveryClient } from '../lib/delivery-client.js';
import {
  makeHealthDouble,
  makePortfolioAiCode,
  makePortfolioDelivery,
  pending,
  PROJECT_UUID,
  serverRefusal,
} from '../test-utils.js';
import { Portfolio, scorecardCellText } from './Portfolio.js';

const ENTRY = {
  projectId: PROJECT_UUID,
  name: 'Service',
  slug: 'service',
  branch: 'main',
  score: 74,
  letter: 'C' as const,
  incomplete: false,
  limiter: 'Limited by Security',
  worst: 'security' as const,
  trend: 2,
  lastReportAt: '2026-10-23T12:00:00.000Z',
};
const OTHER = { ...ENTRY, projectId: 'project-other', name: 'Other', slug: 'other' };

function health() {
  return makeHealthDouble('viewer', {
    getPortfolio: vi.fn(async () => ({ projects: [ENTRY, OTHER] })),
  });
}

function delivery(getPortfolio: () => Promise<PortfolioDelivery>): DeliveryClient {
  return { getPortfolio: vi.fn(getPortfolio) } as unknown as DeliveryClient;
}

function aiCode(getPortfolio: () => Promise<PortfolioAiCode>): AiCodeClient {
  return { getPortfolio: vi.fn(getPortfolio) } as unknown as AiCodeClient;
}

describe('the portfolio’s delivery and AI columns', () => {
  it('adds DORA with its tiers, flow and AI share to each repository it reports on', async () => {
    const deliveryClient = delivery(async () => makePortfolioDelivery());
    const aiClient = aiCode(async () => makePortfolioAiCode());
    render(<Portfolio health={health()} delivery={deliveryClient} aiCode={aiClient} />);
    const dora = await screen.findByTestId(`portfolio-dora-${PROJECT_UUID}`);
    await waitFor(() => expect(dora).toHaveTextContent('82 · Pass'));
    expect(dora).toHaveTextContent('Deploys elite, Lead time high, Failure rate —, Recovery low');
    expect(screen.getByTestId(`portfolio-flow-${PROJECT_UUID}`)).toHaveTextContent('40 · Fail');
    expect(screen.getByTestId(`portfolio-ai-${PROJECT_UUID}`)).toHaveTextContent('35% of 20');
    expect(screen.getByTestId('portfolio-dora-project-other')).toHaveTextContent('not reported');
    expect(screen.getByTestId('portfolio-flow-project-other')).toHaveTextContent('not reported');
    expect(screen.getByTestId('portfolio-ai-project-other')).toHaveTextContent('not reported');
    expect(screen.getByRole('columnheader', { name: 'DORA' })).toBeInTheDocument();
    expect(deliveryClient.getPortfolio).toHaveBeenCalledWith(30);
    expect(aiClient.getPortfolio).toHaveBeenCalledWith(90);
  });

  it('says a read is in flight, failed, or has nothing merged', async () => {
    const ai = makePortfolioAiCode();
    render(
      <Portfolio
        health={health()}
        delivery={delivery(async () => {
          throw serverRefusal('down');
        })}
        aiCode={aiCode(async () => ({
          ...ai,
          projects: [{ ...ai.projects[0]!, aiShare: null, changes: 0 }],
        }))}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId(`portfolio-dora-${PROJECT_UUID}`)).toHaveTextContent('unread'),
    );
    expect(screen.getByTestId(`portfolio-ai-${PROJECT_UUID}`)).toHaveTextContent(
      'no change merged',
    );
  });

  it('shows a loading mark, and only the column it was given a client for', async () => {
    render(<Portfolio health={health()} delivery={delivery(() => pending<PortfolioDelivery>())} />);
    expect(await screen.findByTestId(`portfolio-dora-${PROJECT_UUID}`)).toHaveTextContent('…');
    expect(screen.getByTestId(`portfolio-ai-${PROJECT_UUID}`)).toHaveTextContent('—');
  });

  it('leaves the columns out without either client', async () => {
    render(<Portfolio health={health()} />);
    expect(await screen.findByTestId('portfolio-row-service')).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'DORA' })).not.toBeInTheDocument();
  });

  it('writes a scorecard cell as its score and verdict, or the verdict alone', () => {
    expect(scorecardCellText({ status: 'pass', score: 81.6 })).toBe('82 · Pass');
    expect(scorecardCellText({ status: 'not_configured', score: null })).toBe('Not configured');
  });
});
