/**
 * Formatting a KPI, from the unit it declared.
 *
 * ## The one place that knows the difference
 *
 * GLASS-3 was two formatters in the web app, chosen per call site by a human who
 * remembered which endpoint sends a percentage and which sends a ratio — and the
 * answer a reader got was `0.5%` for a fifty percent. The server now declares the
 * unit on every KPI it sends, so this function is the only place the mapping from
 * unit to string lives, and a screen no longer has to know anything.
 *
 * **`null` renders as `not measured`, never as `0`.** "No run recorded a
 * duration" and "the average duration was zero" are different statements about a
 * suite, and the second is never true of a suite that ran.
 */
import type { Kpi } from '@automate/shared-contracts';

export function formatKpiValue(kpi: Kpi): string {
  if (kpi.value === null) return 'not measured';
  switch (kpi.unit) {
    case 'percent':
      return `${kpi.value}%`;
    case 'ratio':
      // A ratio is a fraction, not a percentage: 0.5 is half, and printing `50%`
      // here is the whole defect. The locale string keeps three significant
      // digits, which is what a rate like 0.042 reads as.
      return kpi.value.toLocaleString('en-US', { maximumFractionDigits: 3 });
    case 'duration_ms':
      return kpi.value >= 1000
        ? `${(kpi.value / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 })}s`
        : `${kpi.value}ms`;
    case 'count':
      return kpi.value.toLocaleString('en-US');
    case 'text':
      return String(kpi.value);
    default:
      // Unreachable while the contract's enum is closed; a `default` that throws
      // would be a statement the compiler cannot check, and one that returns the
      // raw number is honest about not knowing.
      return String(kpi.value);
  }
}

/** The denominator sentence, when the KPI has one. */
export function formatKpiDenominator(kpi: Kpi): string | null {
  if (kpi.denominator === null || kpi.denominator === 0) return null;
  if (kpi.unit === 'duration_ms') return `of ${kpi.denominator} runs that recorded one`;
  return `of ${kpi.denominator}`;
}
