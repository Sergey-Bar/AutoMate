import { createHash } from 'node:crypto';
import type { CanonicalRunResult as RunResult } from '@automate/shared-contracts';

/**
 * How every canonical run status is classified.
 *
 * This is exhaustive over the status enum by construction: the `satisfies`
 * guard below is a compile error if a status is added without deciding what it
 * means. The previous hand-maintained list was silent about `cancelled` and
 * `timedOut`, so those two statuses quietly landed in the pass-rate
 * denominator and nobody was told.
 *
 * Three classes, not two:
 *  - `product` — the product under test produced a determinate outcome and
 *    belongs in the pass-rate denominator. `timedOut` is here on purpose: a
 *    timeout is a real result about the product, and counting it as anything
 *    other than a non-pass would overstate quality.
 *  - `nonProduct` — the harness, not the product, decided. These prove nothing
 *    about the product, so they must stay out of every product denominator and
 *    be reported as explicit exclusions. `cancelled` belongs here: cancelling
 *    a run yields no outcome at all.
 *  - `indeterminate` — no outcome was produced (`unknown`).
 */
const STATUS_CLASSIFICATION = {
  passed: 'product',
  failed: 'product',
  flaky: 'product',
  skipped: 'product',
  timedOut: 'product',
  cancelled: 'nonProduct',
  blocked: 'nonProduct',
  configFailed: 'nonProduct',
  infraFailed: 'nonProduct',
  runnerFailed: 'nonProduct',
  unknown: 'indeterminate',
} as const satisfies Record<RunResult['status'], 'product' | 'nonProduct' | 'indeterminate'>;

export type StatusClass = (typeof STATUS_CLASSIFICATION)[keyof typeof STATUS_CLASSIFICATION];

/** Statuses that describe the harness around a test, not the product under test. */
export const NON_PRODUCT_STATUSES = Object.entries(STATUS_CLASSIFICATION)
  .filter(([, classification]) => classification === 'nonProduct')
  .map(([status]) => status)
  .filter((status): status is RunResult['status'] => status !== undefined);

export type NonProductStatus = (typeof NON_PRODUCT_STATUSES)[number];

const NON_PRODUCT_STATUS_SET: ReadonlySet<string> = new Set(NON_PRODUCT_STATUSES);

export function isNonProductStatus(status: RunResult['status']): boolean {
  return NON_PRODUCT_STATUS_SET.has(status);
}

/** A determinate product outcome: neither unknown nor a non-product status. */
export function isProductOutcome(status: RunResult['status']): boolean {
  return STATUS_CLASSIFICATION[status] === 'product';
}

/** The classification of a status, for reporting explicit exclusions. */
export function classifyStatus(status: RunResult['status']): StatusClass {
  return STATUS_CLASSIFICATION[status];
}

/** Every status value, so callers can prove they have covered the enum. */
export const ALL_RUN_STATUSES = Object.keys(STATUS_CLASSIFICATION) as RunResult['status'][];

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

/**
 * Decides whether a report covers the shards it claims to.
 *
 * Fail-closed on three counts, all of which previously produced `complete`:
 *  - a non-integer or negative expected count is a caller bug, not a verdict,
 *    so it throws rather than reporting on an impossible range;
 *  - an expected count of zero is not a complete report, it is no report at
 *    all, so it is `partial` — a "0 shards received, 0 expected" run used to
 *    certify itself as complete evidence;
 *  - a received index outside the expected range is reported, not dropped,
 *    because an unexpected shard means the report does not match its own
 *    declaration.
 *
 * `missingShards` and `duplicateShards` are sorted so the verdict is a pure
 * function of the inputs rather than of the iteration order.
 */
export function evaluateCompleteness(
  expectedShardCount: number,
  receivedShardIndexes: number[],
  options: CompletenessOptions = {},
) {
  if (!Number.isInteger(expectedShardCount) || expectedShardCount < 0) {
    throw new RangeError(
      `expectedShardCount must be a non-negative integer, got ${expectedShardCount}`,
    );
  }
  if (receivedShardIndexes.some((index) => !Number.isInteger(index) || index < 0)) {
    throw new RangeError('received shard indexes must be non-negative integers');
  }
  const expected = Array.from({ length: expectedShardCount }, (_, index) => index);
  const counts = new Map<number, number>();
  for (const index of receivedShardIndexes) counts.set(index, (counts.get(index) ?? 0) + 1);
  const missingShards = expected.filter((index) => !counts.has(index));
  const duplicateShards = [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([index]) => index)
    .sort((left, right) => left - right);
  const unexpectedShards = [...counts.keys()]
    .filter((index) => index >= expectedShardCount)
    .sort((left, right) => left - right);
  const state: CompletenessState = options.rejected
    ? 'rejected'
    : expectedShardCount === 0 ||
        missingShards.length > 0 ||
        duplicateShards.length > 0 ||
        unexpectedShards.length > 0
      ? 'partial'
      : 'complete';
  return { state, missingShards, duplicateShards, unexpectedShards } as const;
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
