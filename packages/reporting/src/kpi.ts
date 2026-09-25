import type { CanonicalProof, CanonicalRunResult } from '@automate/shared-contracts';
import { isNonProductStatus, isProductOutcome } from './policy.js';

export type ProofCeiling = CanonicalProof['state'] | 'unknown' | 'rejected';

export interface KpiReadModel {
  metric: string;
  value: number | null;
  numerator: number;
  denominator: number;
  unknown: number;
  nonProduct: number;
  exclusions: Array<{ reason: string; count: number }>;
  proofCeiling: ProofCeiling;
  confidence: 'high' | 'medium' | 'low';
  freshness: string;
}

/**
 * Ceiling states ordered from the weakest claim to the strongest. A population
 * is only as trustworthy as its weakest run, so the reported ceiling is the
 * first entry of this order present in the population. Deterministic and
 * independent of result ordering.
 */
const PROOF_CEILING_ORDER = [
  'contradictory',
  'unproven',
  'unavailable',
  'inconclusive',
  'stale',
  'unknown',
  'rejected',
  'unverified',
  'proven',
  'verified',
] as const satisfies readonly ProofCeiling[];

function weakerCeiling(left: ProofCeiling, right: ProofCeiling): ProofCeiling {
  return PROOF_CEILING_ORDER.indexOf(left) <= PROOF_CEILING_ORDER.indexOf(right) ? left : right;
}

function resolveProofCeiling(results: CanonicalRunResult[]): ProofCeiling {
  const candidates: ProofCeiling[] = results.map((result) => result.proof.state);
  if (results.some((result) => result.completeness.state === 'unknown')) candidates.push('unknown');
  if (results.some((result) => result.completeness.state === 'rejected')) {
    candidates.push('rejected');
  }
  if (candidates.length === 0) return 'verified';
  return candidates.reduce(weakerCeiling);
}

function quantile(values: number[], percentile: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil(percentile * sorted.length) - 1);
  return sorted[Math.max(0, index)] ?? null;
}

export function calculateKpis(results: CanonicalRunResult[], now = new Date()): KpiReadModel[] {
  const attempts = results.flatMap((result) => result.attempts);
  // Non-product and unknown attempts are excluded from every product rate so a
  // blocked or infra-broken run can never be reported as a product pass or fail.
  const productAttempts = attempts.filter((attempt) => isProductOutcome(attempt.status));
  const unknown = attempts.filter((attempt) => attempt.status === 'unknown').length;
  const nonProduct = attempts.filter((attempt) => isNonProductStatus(attempt.status)).length;
  const passed = productAttempts.filter((attempt) => attempt.status === 'passed').length;
  const failed = productAttempts.filter((attempt) => attempt.status === 'failed').length;
  const flaky = productAttempts.filter((attempt) => attempt.flakiness === 'observed').length;
  const durations = productAttempts
    .map((attempt) => attempt.durationMs)
    .filter((duration): duration is number => typeof duration === 'number');
  const population = productAttempts.length;
  const proofCeiling = resolveProofCeiling(results);
  const common: Omit<KpiReadModel, 'metric' | 'value' | 'numerator'> = {
    denominator: attempts.length,
    unknown,
    nonProduct,
    exclusions: [
      { reason: 'unknown-status', count: unknown },
      { reason: 'non-product-status', count: nonProduct },
    ],
    proofCeiling,
    confidence: results.every((result) => result.completeness.state === 'complete')
      ? 'high'
      : 'low',
    freshness: now.toISOString(),
  };
  return [
    {
      metric: 'first-pass-rate',
      value: population === 0 ? null : passed / population,
      numerator: passed,
      ...common,
    },
    {
      metric: 'execution-failure-rate',
      value: population === 0 ? null : failed / population,
      numerator: failed,
      ...common,
    },
    {
      metric: 'flake-rate',
      value: population === 0 ? null : flaky / population,
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
