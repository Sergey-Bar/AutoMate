import { createHash } from 'node:crypto';
import type { CanonicalRunResult as RunResult } from '@automate/shared-contracts';

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

export function evaluateCompleteness(expectedShardCount: number, receivedShardIndexes: number[]) {
  const expected = Array.from({ length: expectedShardCount }, (_, index) => index);
  const counts = new Map<number, number>();
  for (const index of receivedShardIndexes) counts.set(index, (counts.get(index) ?? 0) + 1);
  const missingShards = expected.filter((index) => !counts.has(index));
  const duplicateShards = [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([index]) => index);
  const state = missingShards.length > 0 || duplicateShards.length > 0 ? 'partial' : 'complete';
  return { state, missingShards, duplicateShards } as const;
}

export function classifyRetention(
  result: Pick<RunResult, 'retention'>,
  facts: { quarantined?: boolean; legalHold?: boolean } = {},
) {
  if (facts.legalHold) return { class: 'legal_hold' as const, reason: 'legal-hold' };
  if (facts.quarantined) return { class: 'quarantine' as const, reason: 'quarantined' };
  return result.retention;
}
