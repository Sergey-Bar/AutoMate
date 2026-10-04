import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  DefinitionList,
  DefinitionListDetail,
  DefinitionListTerm,
} from './DefinitionList/DefinitionList.js';
import { Meter } from './Meter/Meter.js';
import { Sparkline } from './Sparkline/Sparkline.js';

/**
 * Three primitives, and the decision each one makes.
 *
 * Each test below is about the *decision*, not about the markup. The markup is asserted
 * where the markup is the point — `role="meter"` versus `role="progressbar"` is a
 * semantics question and there is nothing to assert about it but the attribute.
 */
describe('a definition list is a definition list', () => {
  it('renders dl, dt and dd rather than two divs', () => {
    const { container } = render(
      <DefinitionList>
        <DefinitionListTerm>Capping value</DefinitionListTerm>
        <DefinitionListDetail>0.42</DefinitionListDetail>
      </DefinitionList>,
    );
    // The whole reason the primitive exists. Seven screens rendered a key/value pair as
    // two divs, and a screen reader announces two unrelated strings where it could have
    // said "capping value, 0.42" as a unit.
    expect(container.querySelector('dl')).not.toBeNull();
    expect(container.querySelectorAll('dt')).toHaveLength(1);
    expect(container.querySelectorAll('dd')).toHaveLength(1);
    expect(container.querySelectorAll('div')).toHaveLength(0);
  });

  it('sets a value in tabular numerals, because the values here update', () => {
    render(
      <DefinitionList>
        <DefinitionListTerm>Flake rate</DefinitionListTerm>
        <DefinitionListDetail>0.02</DefinitionListDetail>
      </DefinitionList>,
    );
    expect(screen.getByText('0.02')).toHaveClass('tabular-nums');
  });
});

describe('a meter is a meter and not a progress bar', () => {
  it('says what the number is, and never says work is happening', () => {
    render(<Meter label="Backend coverage" value={0.72} />);
    const meter = screen.getByRole('meter');
    expect(meter).toHaveAccessibleName('Backend coverage');
    expect(meter).toHaveAttribute('aria-valuenow', '72');
    expect(meter).toHaveAttribute('aria-valuetext', '72%');
    // `progressbar` announces "working". A coverage number is a fact about a repository
    // and will not change on its own, which is what `meter` is for.
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('draws nothing at all when there is no measurement', () => {
    const { container } = render(<Meter label="Frontend coverage" unmeasured />);
    const meter = screen.getByRole('meter');
    expect(meter).toHaveAttribute('aria-valuetext', 'not measured');
    // A bar with no `aria-valuenow` is a value that was never read, as distinct from a
    // value of zero, which is a measurement.
    expect(meter).not.toHaveAttribute('aria-valuenow');
    expect(container.querySelector('[data-testid="meter-fill"]')).toBeNull();
    expect(container.querySelector('[data-testid="meter-empty"]')).not.toBeNull();
  });

  /**
   * The defect this state exists to prevent.
   *
   * The Cockpit drew "unmeasured" as a **solid 40×12 bar in a muted ink**, which at a
   * glance is a failed image load: a flat rectangle with nothing in it, in a row where every
   * other cell is a coloured bar. It was not caught by any assertion, because every
   * assertion about that cell was about *which colour* it used and it correctly used none.
   *
   * So the assertion is about the *fill*: an unmeasured meter has no fill element at all,
   * and therefore nothing a reader's eye can mistake for a bar.
   */
  it('draws no fill for an unmeasured value, so it cannot read as a failed image', () => {
    const { container } = render(<Meter label="Platform coverage" />);
    expect(container.querySelector('[data-testid="meter-fill"]')).toBeNull();
    expect(container.querySelector('[data-testid="meter-empty"]')).not.toBeNull();
    // And the inverse: a measured meter does draw one.
    const measured = render(<Meter label="Platform coverage" value={0} />);
    expect(measured.container.querySelector('[data-testid="meter-fill"]')).not.toBeNull();
  });

  it('clamps a value rather than trusting it', () => {
    const { container } = render(<Meter label="Backend coverage" value={1.4} />);
    const fill = container.querySelector('[data-testid="meter-fill"]') as HTMLElement;
    // A bar at 140% either overflows its track or silently becomes 100%, and both are a
    // wrong number drawn confidently. Clamped, and `aria-valuenow` agrees.
    expect(fill.style.transform).toBe('scaleX(1)');
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', '100');
  });

  it('scales the fill rather than resizing it, so a repaint is not a layout pass', () => {
    const { container } = render(<Meter label="Backend coverage" value={0.5} />);
    const fill = container.querySelector('[data-testid="meter-fill"]') as HTMLElement;
    expect(fill.style.transform).toBe('scaleX(0.5)');
    // A width percentage would be a layout pass per frame, with the subtree behind it.
    expect(fill.style.width).toBe('');
    expect(fill).toHaveClass('origin-left');
  });
});

describe('a sparkline shows shape and stops there', () => {
  it('is a named image, not a chart', () => {
    render(
      <Sparkline
        points={[0.1, 0.4, 0.35, 0.8]}
        label="Pass rate, last 8 runs"
        value="80%"
        trend="up"
      />,
    );
    const sparkline = screen.getByRole('img');
    expect(sparkline).toHaveAccessibleName('Pass rate, last 8 runs, 80%, trending up');
    // The inner `<svg>` is hidden from assistive technology, so the name is announced once
    // rather than as an unlabelled graphic plus a label.
    expect(screen.getAllByRole('img')).toHaveLength(1);
  });

  /**
   * The branch a naive implementation gets wrong.
   *
   * Three identical values give a minimum and a maximum that are the same number. The
   * usual normalisation divides by zero, returns nothing, and the component draws an empty
   * box — which reads as "no data", the one thing a chart of nothing must never look like.
   */
  it('draws a flat series as a line rather than dividing by zero and drawing nothing', () => {
    const { container } = render(<Sparkline points={[0.5, 0.5, 0.5]} label="Flake rate" />);
    const path = container.querySelector('[data-testid="sparkline-path"]');
    expect(path).not.toBeNull();
    const d = path?.getAttribute('d') ?? '';
    expect(d.length).toBeGreaterThan(0);
    // A flat series is horizontal: the three y values are identical.
    const ys = [...d.matchAll(/[ML] ([\d.]+) ([\d.]+)/g)].map((match) => match[2]);
    expect(new Set(ys).size, `the three points have different heights: ${d}`).toBe(1);
  });

  it('has no axes, no gridlines and no tick labels, because then it would be a chart', () => {
    const { container } = render(<Sparkline points={[0.1, 0.9]} label="Pass rate" />);
    expect(container.querySelectorAll('line').length).toBe(0);
    expect(container.querySelectorAll('text').length).toBe(0);
    expect(container.querySelectorAll('g').length).toBe(0);
    // Fixed box, so it cannot grow into a chart by accident.
    expect(container.querySelector('svg')).toHaveAttribute('viewBox', '0 0 96 32');
  });

  it('draws nothing rather than a wrong shape for an empty series, and says so', () => {
    const { container } = render(<Sparkline points={[]} label="Pass rate, no runs yet" />);
    expect(container.querySelector('[data-testid="sparkline-path"]')).toBeNull();
    // The name is still there, so an empty sparkline is announced as what it is.
    expect(screen.getByRole('img')).toHaveAccessibleName('Pass rate, no runs yet');
  });

  it('skips a point it cannot use rather than plotting a hole through the series', () => {
    const { container } = render(<Sparkline points={[0.2, Number.NaN, 0.8]} label="Pass rate" />);
    const d = container.querySelector('[data-testid="sparkline-path"]')?.getAttribute('d') ?? '';
    expect(d.split('L').length).toBe(2);
  });
});
