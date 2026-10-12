import { describe, expect, it } from 'vitest';
import type { Kpi } from '@automate/shared-contracts';
import { formatKpiDenominator, formatKpiValue } from './kpi-format.js';

/**
 * The formatter, tested against the units rather than the values.
 *
 * **The unit is what is under test.** A `percent` prints with a sign, a `ratio`
 * does not, a duration rescales to seconds past a thousand — and each of those
 * is a place the old two-formatter arrangement got it wrong. What is asserted
 * here is not that `50` becomes `"50%"` but that **only** a `percent` gets a
 * percent sign, which is the invariant the KPI endpoint was built to make
 * checkable.
 */

function kpi(overrides: Partial<Kpi> = {}): Kpi {
  return {
    id: 'test',
    label: 'Test',
    value: 0,
    unit: 'count',
    denominator: null,
    qualifier: null,
    ...overrides,
  };
}

describe('formatKpiValue', () => {
  it('prints a percent with its sign', () => {
    expect(formatKpiValue(kpi({ unit: 'percent', value: 50 }))).toBe('50%');
    expect(formatKpiValue(kpi({ unit: 'percent', value: 100 }))).toBe('100%');
  });

  it('prints a ratio as a fraction, with no percent sign', () => {
    // **The GLASS-3 assertion.** A 0.5 ratio is half, and `0.5%` is that number
    // wrong by two orders of magnitude — read as authoritative by anybody
    // glancing at a card.
    expect(formatKpiValue(kpi({ unit: 'ratio', value: 0.5 }))).toBe('0.5');
    expect(formatKpiValue(kpi({ unit: 'ratio', value: 0.042 }))).toBe('0.042');
  });

  it('rescales a duration past a thousand milliseconds, and not before', () => {
    // A 4200ms average reads as `4.2s`, and a 940ms one stays in milliseconds:
    // `0.9s` is the same number a reader has to convert, which is what the
    // unit is there to avoid.
    expect(formatKpiValue(kpi({ unit: 'duration_ms', value: 4200 }))).toBe('4.2s');
    expect(formatKpiValue(kpi({ unit: 'duration_ms', value: 940 }))).toBe('940ms');
  });

  it('prints a count as a number', () => {
    expect(formatKpiValue(kpi({ unit: 'count', value: 1284 }))).toBe('1,284');
  });

  it('says not measured for a null, and never prints it as zero', () => {
    // An empty install sends `null` for the pass rate, and a screen that printed
    // `0%` would be claiming a measurement nobody took.
    for (const unit of ['percent', 'ratio', 'duration_ms', 'count', 'text'] as const) {
      expect(formatKpiValue(kpi({ unit, value: null }))).toBe('not measured');
    }
  });
});

describe('formatKpiDenominator', () => {
  it('names what the number was computed over', () => {
    expect(formatKpiDenominator(kpi({ denominator: 12 }))).toBe('of 12');
    expect(formatKpiDenominator(kpi({ unit: 'duration_ms', denominator: 3 }))).toBe(
      'of 3 runs that recorded one',
    );
  });

  it('says nothing when there is no denominator to name', () => {
    // Zero is the empty install, and `of 0 runs` would be a sentence about a
    // rate that has not been computed.
    expect(formatKpiDenominator(kpi({ denominator: null }))).toBeNull();
    expect(formatKpiDenominator(kpi({ denominator: 0 }))).toBeNull();
  });
});
