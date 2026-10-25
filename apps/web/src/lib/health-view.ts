import {
  HEALTH_DIMENSION_LABELS,
  type DimensionScore,
  type FindingSeverity,
  type HealthGrade,
  type HealthLetter,
} from '@automate/shared-contracts';

/**
 * How a health payload is read on screen, as pure functions.
 *
 * Nothing here re-derives a number: the grade, the limiter and the fix-next ranking all
 * arrive computed by the server's `grade()`. These only decide tone and wording.
 */

/** Colour is a verdict or nothing: good letters read as success, poor ones as a warning or danger. */
export function letterTone(letter: HealthLetter | null): string {
  switch (letter) {
    case 'A+':
    case 'A':
      return 'text-success';
    case 'B':
      return 'text-fg';
    case 'C':
    case 'D':
      return 'text-warning';
    case 'F':
      return 'text-danger';
    default:
      return 'text-fg-muted';
  }
}

export function meterVariant(
  letter: HealthLetter | null,
): 'success' | 'warning' | 'danger' | 'neutral' {
  if (letter === 'A+' || letter === 'A') return 'success';
  if (letter === 'F') return 'danger';
  if (letter === 'C' || letter === 'D') return 'warning';
  return 'neutral';
}

export const SEVERITY_VARIANT: Readonly<
  Record<FindingSeverity, 'danger' | 'warning' | 'secondary' | 'outline'>
> = {
  critical: 'danger',
  high: 'danger',
  medium: 'warning',
  low: 'secondary',
  info: 'outline',
};

export function dimensionLabel(dimension: DimensionScore['dimension']): string {
  return HEALTH_DIMENSION_LABELS[dimension];
}

/** What is good: dimensions graded A or better, then gates that hold. Never invented. */
export function whatIsGood(grade: HealthGrade): string[] {
  const dimensions = grade.dimensions
    .filter((entry) => entry.letter === 'A+' || entry.letter === 'A')
    .map(
      (entry) =>
        `${dimensionLabel(entry.dimension)} ${entry.letter ?? ''} — ${entry.summary[0] ?? 'measured'}`,
    );
  const gates = grade.gates
    .filter((gate) => gate.enabled && !gate.tripped)
    .map((gate) => gate.statement);
  return [...dimensions, ...gates];
}

/** What could not be judged, so a missing scanner reads as missing rather than as clean. */
export function notMeasured(grade: HealthGrade): string[] {
  return grade.dimensions
    .filter((entry) => !entry.measured)
    .map((entry) => dimensionLabel(entry.dimension));
}

/** "3 hours ago" for a timestamp, against `now`. Coarse on purpose. */
export function ago(iso: string | null, now: Date = new Date()): string {
  if (iso === null) return 'never';
  const seconds = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 1000));
  const steps: ReadonlyArray<readonly [number, string]> = [
    [60, 'second'],
    [60, 'minute'],
    [24, 'hour'],
    [30, 'day'],
    [12, 'month'],
  ];
  let value = seconds;
  for (const [size, unit] of steps) {
    if (value < size) return `${String(value)} ${unit}${value === 1 ? '' : 's'} ago`;
    value = Math.floor(value / size);
  }
  return `${String(value)} year${value === 1 ? '' : 's'} ago`;
}
