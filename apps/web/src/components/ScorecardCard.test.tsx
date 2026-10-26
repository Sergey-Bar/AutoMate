import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { METRIC_UNITS } from '@automate/shared-contracts';
import { makeMetric, makeScorecard } from '../test-utils.js';
import { ScorecardCard } from './ScorecardCard.js';

describe('ScorecardCard', () => {
  it('leads with the verdict, the score and what limited it', () => {
    render(<ScorecardCard scorecard={makeScorecard()} />);
    const card = screen.getByTestId('scorecard-delivery');
    expect(card).toHaveAttribute('data-status', 'pass');
    expect(within(card).getByRole('heading', { level: 2, name: 'Delivery' })).toBeInTheDocument();
    expect(within(card).getByTestId('scorecard-status')).toHaveTextContent('Pass');
    expect(within(card).getByTestId('scorecard-score')).toHaveTextContent('82/ 100');
    expect(within(card).getByTestId('scorecard-capped')).toHaveTextContent(
      'Limited by Change lead time',
    );
    expect(card).toHaveTextContent('Over 30 days');
  });

  it('draws a metric with its value, target, band, sample and a trend in its own direction', () => {
    render(<ScorecardCard scorecard={makeScorecard()} />);
    const metric = screen.getByTestId('metric-lead-time');
    expect(within(metric).getByTestId('metric-value')).toHaveTextContent('20.0 h');
    expect(within(metric).getByTestId('metric-value')).toHaveClass('text-success');
    expect(metric).toHaveTextContent('target ≤ 24.0 h · high · n = 12');
    // A falling lead time is better: lower is better for it.
    expect(metric).toHaveTextContent('\u22124.0 h (better)');
  });

  it('calls a rising lower-better metric worse, and a target on a higher-better one a floor', () => {
    render(
      <ScorecardCard
        scorecard={makeScorecard({
          metrics: [
            makeMetric({ key: 'a', trend: 3 }),
            makeMetric({
              key: 'b',
              direction: 'higher-better',
              unit: 'per-week',
              value: 3,
              target: 5,
              trend: 0,
              band: null,
              sampleSize: null,
              status: 'warn',
            }),
          ],
          cappedBy: 'b',
        })}
      />,
    );
    expect(screen.getByTestId('metric-a')).toHaveTextContent('+3.0 h (worse)');
    const floor = screen.getByTestId('metric-b');
    expect(floor).toHaveTextContent('target ≥ 5.0/week');
    expect(floor).not.toHaveTextContent('n =');
    expect(floor).toHaveTextContent('±0');
    expect(within(floor).getByTestId('metric-value')).toHaveClass('text-warning');
  });

  it.each(METRIC_UNITS)('formats a %s metric by its unit', (unit) => {
    render(
      <ScorecardCard
        scorecard={makeScorecard({
          metrics: [makeMetric({ key: 'm', unit, value: 2, target: null, trend: null })],
          cappedBy: 'm',
        })}
      />,
    );
    expect(within(screen.getByTestId('metric-m')).getByTestId('metric-value').textContent).not.toBe(
      '',
    );
  });

  it('draws an insufficient and a not-configured metric with no colour, and says so', () => {
    render(
      <ScorecardCard
        scorecard={makeScorecard({
          metrics: [
            makeMetric({ key: 'few', value: null, trend: 2, status: 'insufficient' }),
            makeMetric({ key: 'off', value: null, trend: null, status: 'not_configured' }),
            makeMetric({ key: 'bad', value: 40, status: 'bad', target: null }),
          ],
          cappedBy: 'bad',
        })}
      />,
    );
    const few = within(screen.getByTestId('metric-few')).getByTestId('metric-value');
    expect(few).toHaveTextContent('too little data');
    expect(few).toHaveClass('text-fg-muted');
    expect(screen.getByTestId('metric-few')).not.toHaveTextContent('(better)');
    expect(screen.getByTestId('metric-few')).not.toHaveTextContent('(worse)');
    expect(within(screen.getByTestId('metric-off')).getByTestId('metric-value')).toHaveTextContent(
      'not configured',
    );
    expect(within(screen.getByTestId('metric-bad')).getByTestId('metric-value')).toHaveClass(
      'text-danger',
    );
  });

  it('lists every reason on a failing card', () => {
    render(
      <ScorecardCard
        scorecard={makeScorecard({
          status: 'fail',
          score: 30,
          reasons: ['Lead time over 24 h', 'Too few deploys'],
        })}
      />,
    );
    expect(screen.getByTestId('scorecard-status')).toHaveTextContent('Fail');
    expect(screen.getByTestId('scorecard-score')).toHaveClass('text-danger');
    const reasons = screen.getByRole('list', { name: 'Why Delivery fails' });
    expect(
      within(reasons)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['Lead time over 24 h', 'Too few deploys']);
  });

  it('flags reasons on a card that is not failing without calling it a failure', () => {
    render(<ScorecardCard scorecard={makeScorecard({ reasons: ['A note'] })} />);
    expect(screen.getByRole('list', { name: 'Why Delivery is flagged' })).toBeInTheDocument();
  });

  it.each([
    ['insufficient', 'Too little data', 'Too little data to score yet.'],
    ['not_configured', 'Not configured', 'Not configured: no source reports on this yet.'],
  ] as const)('shows a %s card with no score and no colour', (status, word, sentence) => {
    render(
      <ScorecardCard
        scorecard={makeScorecard({
          status,
          score: null,
          cappedBy: null,
          metrics: [makeMetric({ value: null, trend: null, status: 'insufficient' })],
        })}
      />,
    );
    expect(screen.getByTestId('scorecard-status')).toHaveTextContent(word);
    expect(screen.getByTestId('scorecard-status')).toHaveClass('text-fg-muted');
    expect(screen.getByTestId('scorecard-score')).toHaveTextContent(sentence);
    expect(screen.queryByTestId('scorecard-capped')).not.toBeInTheDocument();
  });

  it('says there is no score on a measured card that has none', () => {
    render(
      <ScorecardCard
        scorecard={makeScorecard({ status: 'fail', score: null, cappedBy: null, reasons: ['x'] })}
      />,
    );
    expect(screen.getByTestId('scorecard-score')).toHaveTextContent('No score.');
  });

  it('names the limiter by key when no metric carries it', () => {
    render(<ScorecardCard scorecard={makeScorecard({ cappedBy: 'gone' })} />);
    expect(screen.getByTestId('scorecard-capped')).toHaveTextContent('Limited by gone');
  });

  it('is compact on request, links to its page, and takes a level-three heading', () => {
    render(
      <ScorecardCard
        scorecard={makeScorecard({ metrics: [] })}
        compact
        href="/dashboard/delivery"
        headingLevel={3}
      />,
    );
    expect(screen.queryByRole('list', { name: 'Metrics' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Delivery' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Delivery' })).toHaveAttribute(
      'href',
      '/dashboard/delivery',
    );
  });

  it('draws no metric list for a card with no metrics', () => {
    render(<ScorecardCard scorecard={makeScorecard({ metrics: [] })} />);
    expect(screen.queryByRole('list', { name: 'Metrics' })).not.toBeInTheDocument();
  });
});
