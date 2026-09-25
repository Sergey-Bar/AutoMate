import { createHash } from 'node:crypto';
import type { CanonicalRunResult as RunResult } from '@automate/shared-contracts';

/**
 * Statuses that describe the harness around a test, not the product under test.
 * They are never a pass or a product failure, so they must stay out of every
 * product outcome denominator and be reported as explicit exclusions.
 */
export const NON_PRODUCT_STATUSES = [
  'blocked',
  'configFailed',
  'infraFailed',
  'runnerFailed',
] as const;

export type NonProductStatus = (typeof NON_PRODUCT_STATUSES)[number];

const NON_PRODUCT_STATUS_SET: ReadonlySet<string> = new Set(NON_PRODUCT_STATUSES);

export function isNonProductStatus(status: RunResult['status']): boolean {
  return NON_PRODUCT_STATUS_SET.has(status);
}

/** A determinate product outcome: neither unknown nor a non-product status. */
export function isProductOutcome(status: RunResult['status']): boolean {
  return status !== 'unknown' && !isNonProductStatus(status);
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function fingerprint(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

export interface CompletenessOptions {
  /** Set when the report was explicitly rejected; shard arithmetic cannot un-reject it. */
  rejected?: boolean;
}

export type CompletenessState = 'complete' | 'partial' | 'rejected';

export function evaluateCompleteness(
  expectedShardCount: number,
  receivedShardIndexes: number[],
  options: CompletenessOptions = {},
) {
  const expected = Array.from({ length: expectedShardCount }, (_, index) => index);
  const counts = new Map<number, number>();
  for (const index of receivedShardIndexes) counts.set(index, (counts.get(index) ?? 0) + 1);
  const missingShards = expected.filter((index) => !counts.has(index));
  const duplicateShards = [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([index]) => index);
  const state: CompletenessState = options.rejected
    ? 'rejected'
    : missingShards.length > 0 || duplicateShards.length > 0
      ? 'partial'
      : 'complete';
  return { state, missingShards, duplicateShards } as const;
}

export function classifyRetention(
  result: Pick<RunResult, 'retention'>,
  facts: { quarantined?: boolean; legalHold?: boolean; expired?: boolean } = {},
) {
  if (facts.legalHold) return { class: 'legal_hold' as const, reason: 'legal-hold' };
  if (facts.quarantined) return { class: 'quarantine' as const, reason: 'quarantined' };
  if (facts.expired) return { class: 'expired' as const, reason: 'lifecycle-cleanup' };
  return result.retention;
}
