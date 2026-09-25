import type { CanonicalRunResult } from '@automate/shared-contracts';

export interface KpiReadModel {
  metric: string;
  value: number | null;
  numerator: number;
  denominator: number;
  unknown: number;
  exclusions: Array<{ reason: string; count: number }>;
  proofCeiling: 'verified' | 'unverified' | 'unknown';
  confidence: 'high' | 'medium' | 'low';
  freshness: string;
}

function quantile(values: number[], percentile: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil(percentile * sorted.length) - 1);
  return sorted[Math.max(0, index)] ?? null;
}

export function calculateKpis(results: CanonicalRunResult[], now = new Date()): KpiReadModel[] {
  const attempts = results.flatMap((result) => result.attempts);
  const known = attempts.filter((attempt) => attempt.status !== 'unknown');
  const passed = known.filter((attempt) => attempt.status === 'passed').length;
  const failed = known.filter((attempt) => attempt.status === 'failed').length;
  const flaky = known.filter((attempt) => attempt.flakiness === 'observed').length;
  const durations = known
    .map((attempt) => attempt.durationMs)
    .filter((duration): duration is number => typeof duration === 'number');
  const proofCeiling = results.some((result) => result.proof.state === 'unverified')
    ? 'unverified'
    : results.some((result) => result.completeness.state === 'unknown')
      ? 'unknown'
      : 'verified';
  const common: Omit<KpiReadModel, 'metric' | 'value' | 'numerator'> = {
    denominator: attempts.length,
    unknown: attempts.length - known.length,
    exclusions: [{ reason: 'unknown-status', count: attempts.length - known.length }],
    proofCeiling,
    confidence: results.every((result) => result.completeness.state === 'complete')
      ? 'high'
      : 'low',
    freshness: now.toISOString(),
  };
  return [
    {
      metric: 'first-pass-rate',
      value: known.length === 0 ? null : passed / known.length,
      numerator: passed,
      ...common,
    },
    {
      metric: 'execution-failure-rate',
      value: known.length === 0 ? null : failed / known.length,
      numerator: failed,
      ...common,
    },
    {
      metric: 'flake-rate',
      value: known.length === 0 ? null : flaky / known.length,
      numerator: flaky,
      ...common,
    },
    {
      metric: 'duration-p50',
      value: quantile(durations, 0.5),
      numerator: durations.length,
      ...common,
    },
    {
      metric: 'duration-p95',
      value: quantile(durations, 0.95),
      numerator: durations.length,
      ...common,
    },
  ];
}
