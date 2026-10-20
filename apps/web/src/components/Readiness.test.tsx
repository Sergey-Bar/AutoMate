/// <reference types="vitest/globals" />
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { ReadinessStrip, headline } from './Readiness';
import { makeReadiness } from '../test-utils';
import type { DigestItem, ReleaseReadinessCard } from '../lib/qa';

function renderStrip(
  readiness: ReleaseReadinessCard | null,
  digest: DigestItem[] = [],
  failure: string | null = null,
) {
  const rootRoute = createRootRoute({
    component: () => <ReadinessStrip readiness={readiness} failure={failure} digest={digest} />,
  });
  const router = createRouter({ routeTree: rootRoute });
  router.update({ history: createMemoryHistory({ initialEntries: ['/dashboard'] }) });
  return render(<RouterProvider router={router} />);
}

describe('the readiness strip', () => {
  it('spells out the verdict, leads with the worst reason, and opens every reason', async () => {
    renderStrip(makeReadiness(), [
      { kind: 'new-flaky', tone: 'bad', text: '1 new flaky test' },
      { kind: 'pass-rate', tone: 'good', text: 'Pass rate +4.0 pts' },
    ]);
    const verdict = await screen.findByTestId('readiness-verdict');
    expect(verdict).toHaveTextContent('Caution');
    expect(verdict).toHaveClass('text-warning');
    expect(screen.getByTestId('readiness-strip')).toHaveTextContent(
      '2% of tests were flaky; the gate allows 0%',
    );
    expect(screen.getByTestId('digest-chips')).toHaveTextContent('1 new flaky test');
    expect(screen.getByRole('link', { name: 'Insights' })).toHaveAttribute(
      'href',
      '/dashboard/insights',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Why this verdict' }));
    const dialog = screen.getByTestId('readiness-dialog');
    expect(
      within(dialog).getByRole('heading', { name: 'Release readiness: Caution' }),
    ).toBeInTheDocument();
    const reasons = within(dialog).getAllByRole('listitem');
    expect(reasons[0]).toHaveTextContent('caution: 2% of tests were flaky');
    expect(reasons[1]).toHaveTextContent('passes: The latest quality gate passed');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(within(dialog).queryByRole('heading')).toBeNull());
  });

  it('says so when every check passes, and draws no digest when nothing changed', async () => {
    renderStrip(
      makeReadiness({
        verdict: 'go',
        reasons: [
          {
            code: 'gate',
            level: 'go',
            message: 'The latest quality gate passed',
            evidence: 'run 1',
          },
        ],
      }),
    );
    expect(await screen.findByTestId('readiness-verdict')).toHaveTextContent('Go');
    expect(screen.getByTestId('readiness-strip')).toHaveTextContent('Every readiness check passes');
    expect(screen.queryByTestId('digest-chips')).not.toBeInTheDocument();
  });

  it('marks a no-go in the danger tone', async () => {
    renderStrip(
      makeReadiness({
        verdict: 'no-go',
        reasons: [
          {
            code: 'gate',
            level: 'no-go',
            message: 'The latest quality gate failed',
            evidence: 'run 1',
          },
        ],
      }),
    );
    expect(await screen.findByTestId('readiness-verdict')).toHaveClass('text-danger');
  });

  it('names a read in flight, and a failed read, rather than a verdict', async () => {
    const { unmount } = renderStrip(null);
    expect(await screen.findByTestId('readiness-pending')).toHaveTextContent(
      'Reading release readiness',
    );
    unmount();
    renderStrip(null, [], 'no registry');
    expect(await screen.findByTestId('readiness-pending')).toHaveTextContent(
      'Readiness unread: no registry',
    );
  });

  it('heads a card with no reasons as passing', () => {
    expect(headline({ ...makeReadiness(), reasons: [] })).toBe('Every readiness check passes');
  });
});
