import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { AiCodePullRequestList, AiCodeReport } from '@automate/shared-contracts';
import type { AiCodeClient } from '../lib/ai-code-client.js';
import {
  makeAiCodeReport,
  makeAiPullRequests,
  makeHealthDouble,
  makeQa,
  pending,
  serverRefusal,
  TEST_PROJECT,
} from '../test-utils.js';
import { AiCodePage, rateText, worseThanHuman } from './AiCode.js';

function aiDouble(overrides: Partial<AiCodeClient> = {}): AiCodeClient {
  return {
    getReport: vi.fn(async () => makeAiCodeReport()),
    getPullRequests: vi.fn(async () => makeAiPullRequests()),
    getPortfolio: vi.fn(async () => ({
      windowDays: 90,
      evaluatedAt: '2026-10-23T12:00:00.000Z',
      projects: [],
    })),
    ...overrides,
  };
}

function renderPage(aiCode: AiCodeClient = aiDouble()) {
  return render(<AiCodePage qa={makeQa()} health={makeHealthDouble('viewer')} aiCode={aiCode} />);
}

describe('the AI code page', () => {
  it('leads with how many outcome rates are worse for AI-written change', async () => {
    const aiCode = aiDouble();
    renderPage(aiCode);
    // Agent-authored is "higher" on revert; AI-assisted has too little data to compare.
    expect(await screen.findByTestId('ai-code-status')).toHaveTextContent(
      '1outcome rate is worse for AI-written change than for human change.',
    );
    expect(screen.getByRole('heading', { level: 1, name: 'AI code' })).toBeInTheDocument();
    expect(screen.getByTestId('scorecard-ai-code')).toHaveTextContent(
      'Share of change written with AI',
    );
    expect(aiCode.getReport).toHaveBeenCalledWith(TEST_PROJECT.id, 90);
    expect(screen.queryByTestId('stale-attribution')).not.toBeInTheDocument();
  });

  it('reads another window, and says when attribution is stale', async () => {
    const aiCode = aiDouble({
      getReport: vi.fn(async () => makeAiCodeReport({ staleAttribution: 4 })),
    });
    renderPage(aiCode);
    expect(await screen.findByTestId('stale-attribution')).toHaveTextContent(
      '4 merged pull requests',
    );
    fireEvent.click(screen.getByRole('button', { name: '30 days' }));
    await waitFor(() => expect(aiCode.getReport).toHaveBeenLastCalledWith(TEST_PROJECT.id, 30));
  });

  it('draws weekly share as named stacked bars, and the same figures as a table', async () => {
    renderPage();
    const share = await screen.findByTestId('weekly-share');
    expect(within(share).getByTestId('week-2026-10-12')).toHaveAccessibleName(
      /2 agent-authored, 1 ai-assisted, 4 human, 1 unknown/u,
    );
    expect(within(share).getByTestId('week-2026-10-19')).toHaveAccessibleName(/nothing merged/u);
    expect(within(share).getByRole('list', { name: 'Legend' })).toHaveTextContent('Agent-authored');
    fireEvent.click(within(share).getByRole('button', { name: 'Table' }));
    expect(within(share).getByTestId('week-row-2026-10-12')).toHaveTextContent(
      /2\s*1\s*4\s*1\s*8$/u,
    );
    expect(
      within(share).getByRole('table', { name: 'Merged pull requests by week and attribution' }),
    ).toBeInTheDocument();
  });

  it('says when nothing merged in the window', async () => {
    renderPage(aiDouble({ getReport: vi.fn(async () => makeAiCodeReport({ share: [] })) }));
    expect(await screen.findByTestId('weekly-share')).toHaveTextContent('No pull request merged');
  });

  it('compares outcomes with intervals, and says insufficient where a group is small', async () => {
    renderPage();
    const revert = await screen.findByTestId('outcome-revert');
    expect(revert).toHaveTextContent('10.0% (2.0%–40.0%)');
    expect(revert).toHaveTextContent('higher than human');
    expect(revert).toHaveTextContent('insufficient (n = 0)');
    expect(screen.getByTestId('outcome-followUpFix14')).toHaveTextContent('lower than human');
    expect(screen.getByTestId('outcome-followUpFix30')).toHaveTextContent(
      'too little data to compare',
    );
    expect(screen.getByTestId('outcome-diffCoverage')).toHaveTextContent('81.0%');
    expect(screen.getByTestId('outcome-reviewDepth')).toHaveTextContent('2.5');
    expect(screen.getByTestId('outcome-reviewDepth')).toHaveTextContent('insufficient (n = 2)');
    expect(screen.getByTestId('outcomes')).toHaveTextContent('1 of 30 changes were excluded');
  });

  it('breaks outcomes down by agent, or says none was named', async () => {
    const { unmount } = renderPage();
    expect(await screen.findByTestId('agent-claude-code')).toHaveTextContent('claude-code8');
    unmount();
    const report = makeAiCodeReport();
    renderPage(
      aiDouble({
        getReport: vi.fn(async (): Promise<AiCodeReport> => ({
          ...report,
          comparison: { ...report.comparison, agents: [] },
        })),
      }),
    );
    expect(await screen.findByTestId('ai-agents')).toHaveTextContent('No change in this window');
  });

  it('lists pull requests with their attribution, agent and signals, and nobody', async () => {
    renderPage();
    const first = await screen.findByTestId('pr-12');
    expect(first).toHaveTextContent('#12 Add the importer');
    expect(first).toHaveTextContent('Agent-authored');
    expect(first).toHaveTextContent('claude-code');
    expect(first).toHaveTextContent('95.0%');
    expect(first).toHaveTextContent('trailer: Co-authored-by: Claude');
    expect(screen.getByTestId('pr-13')).toHaveTextContent('No signal');
    expect(screen.getByTestId('ai-prs-range')).toHaveTextContent('1–2 of 2');
  });

  it('filters pull requests by attribution and pages them', async () => {
    const aiCode = aiDouble({
      getPullRequests: vi.fn(async () => makeAiPullRequests({ total: 60 })),
    });
    renderPage(aiCode);
    const panel = await screen.findByTestId('ai-prs');
    fireEvent.change(within(panel).getByLabelText('Attribution'), {
      target: { value: 'ai-assisted' },
    });
    await waitFor(() =>
      expect(aiCode.getPullRequests).toHaveBeenLastCalledWith(TEST_PROJECT.id, {
        attribution: 'ai-assisted',
        offset: 0,
        limit: 25,
      }),
    );
    fireEvent.click(await within(panel).findByRole('button', { name: 'Next' }));
    await waitFor(() =>
      expect(aiCode.getPullRequests).toHaveBeenLastCalledWith(TEST_PROJECT.id, {
        attribution: 'ai-assisted',
        offset: 25,
        limit: 25,
      }),
    );
    fireEvent.change(within(panel).getByLabelText('Attribution'), { target: { value: '' } });
    await waitFor(() =>
      expect(aiCode.getPullRequests).toHaveBeenLastCalledWith(TEST_PROJECT.id, {
        attribution: undefined,
        offset: 0,
        limit: 25,
      }),
    );
  });

  it('says when no pull request matches, a read in flight, and the server’s message', async () => {
    const { unmount } = renderPage(
      aiDouble({ getPullRequests: vi.fn(async () => makeAiPullRequests({ items: [], total: 0 })) }),
    );
    expect(await screen.findByTestId('ai-prs-empty')).toBeInTheDocument();
    unmount();
    const second = renderPage(
      aiDouble({
        getReport: vi.fn(() => pending<AiCodeReport>()),
        getPullRequests: vi.fn(() => pending<AiCodePullRequestList>()),
      }),
    );
    expect(await screen.findByTestId('ai-code-loading')).toBeInTheDocument();
    expect(screen.getByTestId('ai-prs-loading')).toBeInTheDocument();
    second.unmount();
    renderPage(
      aiDouble({
        getReport: vi.fn(async () => {
          throw serverRefusal('Delivery source not configured', 409);
        }),
      }),
    );
    expect(await screen.findByTestId('ai-code-error')).toHaveTextContent(
      'Delivery source not configured',
    );
  });
});

describe('the AI code helpers', () => {
  it('counts outcome rates worse than human across both AI groups', () => {
    const report = makeAiCodeReport();
    expect(worseThanHuman(report.comparison)).toBe(1);
    const groups = report.comparison.groups;
    expect(
      worseThanHuman({
        ...report.comparison,
        groups: {
          ...groups,
          'ai-assisted': {
            ...groups['agent-authored'],
            vsHuman: { ...groups['agent-authored'].vsHuman!, changeFailure: 'higher' },
          },
        },
      }),
    ).toBe(3);
  });

  it('writes a rate with its interval, or why there is none', () => {
    expect(rateText({ successes: 1, trials: 10, rate: 0.1, interval: null }, 5)).toBe('10.0%');
    expect(rateText({ successes: 1, trials: 3, rate: 0.33, interval: null }, 5)).toBe(
      'insufficient (n = 3)',
    );
  });
});
