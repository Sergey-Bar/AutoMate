/// <reference types="vitest/globals" />
import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { FindingsColumns, VerdictHero, headline } from './Readiness';
import { makeReadiness } from '../test-utils';
import { summarizeHealth, type HealthSummary } from '../lib/health-summary';
import { expectNoBlockingAxeViolations } from '../test-axe';
import type { DigestItem, ReleaseReadinessCard } from '../lib/qa';

function renderRouted(node: React.ReactNode) {
  const rootRoute = createRootRoute({ component: () => <>{node}</> });
  const router = createRouter({ routeTree: rootRoute });
  router.update({ history: createMemoryHistory({ initialEntries: ['/dashboard'] }) });
  return render(<RouterProvider router={router} />);
}

function summary(readiness: ReleaseReadinessCard | null, digest: DigestItem[] = []): HealthSummary {
  return summarizeHealth({ projectId: 'project-1', readiness, digest, gaps: null });
}

describe('the verdict hero', () => {
  it('spells out the verdict in words, with the reason that set it', async () => {
    renderRouted(<VerdictHero summary={summary(makeReadiness())} failure={null} />);
    const verdict = await screen.findByTestId('readiness-verdict');
    expect(verdict).toHaveTextContent('Caution');
    expect(verdict).toHaveClass('text-warning');
    expect(screen.getByTestId('readiness-hero')).toHaveTextContent(
      '2% of tests were flaky; the gate allows 0%',
    );
    expect(screen.getByTestId('readiness-counts')).toHaveTextContent('1 to look at · 1 passing');
  });

  it.each([
    ['go', 'Go', 'text-success'],
    ['no-go', 'No-go', 'text-danger'],
  ] as const)('draws %s in its own tone', async (verdict, word, tone) => {
    renderRouted(
      <VerdictHero
        summary={summary(
          makeReadiness({
            verdict,
            reasons: [{ code: 'gate', level: verdict, message: 'Gate', evidence: 'run 1' }],
          }),
        )}
        failure={null}
      />,
    );
    const shown = await screen.findByTestId('readiness-verdict');
    expect(shown).toHaveTextContent(word);
    expect(shown).toHaveClass(tone);
  });

  it('names a read in flight, and a failed read, rather than a verdict', async () => {
    const { unmount } = renderRouted(<VerdictHero summary={null} failure={null} />);
    expect(await screen.findByTestId('readiness-pending')).toHaveTextContent(
      'Reading release readiness',
    );
    unmount();
    renderRouted(<VerdictHero summary={null} failure="no registry" />);
    expect(await screen.findByTestId('readiness-pending')).toHaveTextContent(
      'Readiness unread: no registry',
    );
  });

  it('heads a card with no reasons as passing', () => {
    expect(headline({ ...makeReadiness(), reasons: [] })).toBe('Every readiness check passes');
  });
});

describe('what is wrong, and what is good', () => {
  it('lists each finding with its evidence and a next action', async () => {
    renderRouted(
      <FindingsColumns
        summary={summary(makeReadiness(), [
          { kind: 'new-failure', tone: 'bad', text: '3 new failures' },
          { kind: 'pass-rate', tone: 'good', text: 'Pass rate +4 pts' },
        ])}
      />,
    );
    const wrong = await screen.findByTestId('findings-wrong');
    const items = within(wrong).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('2% of tests were flaky; the gate allows 0%');
    expect(items[0]).toHaveTextContent('flaky results');
    expect(within(items[0] as HTMLElement).getByRole('link')).toHaveAttribute(
      'href',
      '/dashboard/insights',
    );
    expect(within(items[0] as HTMLElement).getByRole('link')).toHaveAccessibleName(
      'See flaky tests: 2% of tests were flaky; the gate allows 0%',
    );
    expect(items[1]).toHaveTextContent('3 new failures');
    // The action's label is its text, never an attribute leaked onto the anchor.
    for (const link of within(wrong).getAllByRole('link')) {
      expect(link).not.toHaveAttribute('label');
    }

    const good = screen.getByTestId('findings-good');
    expect(
      within(good)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual([
      expect.stringContaining('The latest quality gate passed'),
      expect.stringContaining('Pass rate +4 pts'),
    ]);
    expect(wrong).toHaveTextContent('2');
  });

  it('shows five at first, and the rest on request', async () => {
    const digest: DigestItem[] = Array.from({ length: 7 }, (_, index) => ({
      kind: 'new-failure',
      tone: 'bad',
      text: `failure ${String(index)}`,
    }));
    renderRouted(<FindingsColumns summary={summary(null, digest)} />);
    const wrong = await screen.findByTestId('findings-wrong');
    expect(within(wrong).getAllByRole('listitem')).toHaveLength(5);
    const more = within(wrong).getByRole('button', { name: 'Show all 7' });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(more);
    expect(within(wrong).getAllByRole('listitem')).toHaveLength(7);
    expect(within(wrong).getByRole('button', { name: 'Show fewer' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('says plainly when a column is empty, rather than drawing nothing', async () => {
    renderRouted(<FindingsColumns summary={summary(null)} />);
    expect(await screen.findByTestId('findings-wrong')).toHaveTextContent(
      'Nothing is wrong that Automate can see.',
    );
    expect(screen.getByTestId('findings-good')).toHaveTextContent('Nothing has passed yet.');
  });

  it('stacks on a phone and sits side by side from md up', async () => {
    renderRouted(<FindingsColumns summary={summary(makeReadiness())} />);
    expect(await screen.findByTestId('findings')).toHaveClass('grid-cols-1', 'md:grid-cols-2');
  });

  it('has no serious or critical axe violations', async () => {
    const { container } = renderRouted(
      <>
        <VerdictHero summary={summary(makeReadiness())} failure={null} />
        <FindingsColumns summary={summary(makeReadiness())} />
      </>,
    );
    await screen.findByTestId('findings-wrong');
    await expectNoBlockingAxeViolations(container);
  });
});
