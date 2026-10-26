import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { makeApi, makeInsights, makeQa } from '../test-utils.js';
import { InsightsPage } from '../routes/dashboard/insights.js';
import { fileOf, FailureClustersPanel, QuarantineSuggestionsPanel } from './InsightsCauses.js';
import { ToastProvider } from './Toasts.js';

const CLUSTERS = {
  clusters: [
    {
      signature: 'sig-1',
      errorType: 'TimeoutError',
      sampleMessage: 'locator.click: Timeout 5000ms exceeded',
      count: 5,
      tests: ['e2e/a.spec.ts › logs in', 'e2e/b.spec.ts › logs out'],
      branches: ['main', 'feature/x'],
      runs: 3,
      firstSeen: '2026-09-20T10:00:00.000Z',
      lastSeen: '2026-09-26T10:00:00.000Z',
    },
    {
      signature: 'sig-2',
      errorType: null,
      sampleMessage: 'expected 2 to be 3',
      count: 1,
      tests: ['unit/math.test.ts › adds'],
      branches: ['main'],
      runs: 1,
      firstSeen: '2026-09-25T10:00:00.000Z',
      lastSeen: '2026-09-25T10:00:00.000Z',
    },
  ],
  totals: { failures: 6, causes: 2 },
  summary: '6 failures, 2 causes',
};

const SUGGESTIONS = {
  thresholds: { minScore: 0.2, minObservations: 5 },
  suggestions: [
    {
      testKey: 'e2e/login.spec.ts › logs in',
      title: 'logs in',
      flakyScore: 0.5,
      observations: 6,
      retriesSpent: 4,
      wastedMs: 90_000,
      blockedRuns: 2,
      reason: 'Flipped 3 times in 6 runs and cost 4 retries',
    },
  ],
};

describe('failure clusters', () => {
  it('says "N failures, M causes" and lists each cause', () => {
    render(<FailureClustersPanel clusters={CLUSTERS} />);
    expect(screen.getByTestId('clusters-summary')).toHaveTextContent('6 failures, 2 causes');
    const [first, second] = screen.getAllByTestId('failure-cluster');
    expect(first).toHaveTextContent('TimeoutError: locator.click');
    expect(first).toHaveTextContent('5 failures');
    expect(first).toHaveTextContent('2 tests · 3 runs · main, feature/x');
    expect(second).toHaveTextContent('expected 2 to be 3');
    expect(second).toHaveTextContent('1 failure');
    expect(second).toHaveTextContent('1 test · 1 run · main');
  });

  it('says when nothing failed, and when the API does not group failures', () => {
    const { unmount } = render(
      <FailureClustersPanel
        clusters={{
          clusters: [],
          totals: { failures: 0, causes: 0 },
          summary: '0 failures, 0 causes',
        }}
      />,
    );
    expect(screen.getByText('No test failed in this window.')).toBeInTheDocument();
    unmount();
    render(<FailureClustersPanel clusters={undefined} />);
    expect(screen.getByTestId('clusters-unreported')).toBeInTheDocument();
  });
});

describe('quarantine suggestions', () => {
  it('quarantines a suggestion in one click through the existing endpoint, and confirms it', async () => {
    const api = makeApi({ addQuarantine: vi.fn(async () => ({}) as never) });
    render(
      <ToastProvider>
        <QuarantineSuggestionsPanel suggestions={SUGGESTIONS} api={api} />
      </ToastProvider>,
    );
    const row = screen.getByTestId('quarantine-suggestion');
    expect(row).toHaveTextContent('Flipped 3 times in 6 runs');
    expect(row).toHaveTextContent('50% flaky · 4 retries · 1m 30s wasted · 2 runs blocked');
    fireEvent.click(within(row).getByRole('button', { name: 'Quarantine logs in' }));
    await waitFor(() =>
      expect(api.addQuarantine).toHaveBeenCalledWith({
        testTitle: 'logs in',
        testFile: 'e2e/login.spec.ts',
        reason: 'Flipped 3 times in 6 runs and cost 4 retries',
      }),
    );
    expect(await screen.findByText('Quarantined logs in')).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'logs in is quarantined' })).toBeDisabled();
  });

  it('says why a quarantine was refused, and lets the reader try again', async () => {
    const api = makeApi({
      addQuarantine: vi.fn(async () => {
        throw Object.assign(new Error('already quarantined'), { status: 409 });
      }),
    });
    render(
      <ToastProvider>
        <QuarantineSuggestionsPanel suggestions={SUGGESTIONS} api={api} />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Quarantine logs in' }));
    expect(await screen.findByText('already quarantined')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Quarantine logs in' })).toBeEnabled(),
    );
  });

  it('states the bar when nothing clears it, and when the API does not suggest', () => {
    const { unmount } = render(
      <QuarantineSuggestionsPanel
        suggestions={{ ...SUGGESTIONS, suggestions: [] }}
        api={makeApi()}
      />,
    );
    expect(screen.getByTestId('quarantine-suggestions')).toHaveTextContent(
      'a score of 20% over at least 5 runs',
    );
    unmount();
    render(<QuarantineSuggestionsPanel suggestions={undefined} api={makeApi()} />);
    expect(screen.getByTestId('suggestions-unreported')).toBeInTheDocument();
  });

  it('takes the file from the server’s key, or says it is unknown', () => {
    expect(fileOf('e2e/a.spec.ts › logs in')).toBe('e2e/a.spec.ts');
    expect(fileOf(' › logs in')).toBe('(unknown file)');
    expect(fileOf('no separator')).toBe('(unknown file)');
  });
});

describe('the insights page', () => {
  it('shows the causes and the suggestions beside the other panels', async () => {
    render(
      <InsightsPage
        qa={makeQa({
          getInsights: vi.fn(async () =>
            makeInsights({ failureClusters: CLUSTERS, quarantineSuggestions: SUGGESTIONS }),
          ),
        })}
        api={makeApi()}
      />,
    );
    expect(await screen.findByTestId('clusters-summary')).toHaveTextContent('6 failures, 2 causes');
    expect(screen.getByTestId('quarantine-suggestion')).toBeInTheDocument();
  });
});
