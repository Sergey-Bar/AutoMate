import type {
  ArtifactGlob,
  CommandCandidate,
  EcosystemDetection,
  FrameworkSignal,
} from './types.js';

/** What every ecosystem detector is handed, and the one thing it may return. */
export interface DetectorInput {
  /** Every file in the repository, repo-relative and sorted. */
  paths: readonly string[];
  read: (relativePath: string) => Promise<string | null>;
}

/** `null` means "this is not that ecosystem", not "I could not tell". */
export type EcosystemDetector = (input: DetectorInput) => Promise<EcosystemDetection | null>;

export type { ArtifactGlob, CommandCandidate, EcosystemDetection, FrameworkSignal };

/**
 * Which score row a script name claims to be.
 *
 * The order is load-bearing: `e2e` is tested before `integration` because
 * `test:e2e-integration` exists and means an end-to-end suite. The default is
 * `unit` because a script named `test` in a repository with no other signal is a
 * unit suite far more often than not, and "probably unit" is the honest reading
 * of an unlabelled script — the override is one key away.
 */
export function categoryForScriptName(name: string): CommandCandidate['category'] {
  const lower = name.toLowerCase();
  if (/e2e|end-?to-?end|playwright|cypress|selenium|puppeteer/.test(lower)) return 'e2e';
  if (/perf|load|k6|stress|benchmark/.test(lower)) return 'performance';
  if (/security|sec|scan|zap|vuln/.test(lower)) return 'security';
  if (/integration|contract|it\b/.test(lower)) return 'integration';
  return 'unit';
}

/**
 * Folds duplicates that would otherwise be proposed three times over.
 *
 * Keyed by a caller-supplied identity rather than a fixed field, because the
 * lists folded here do not share a shape: two framework signals are the same
 * signal when they cite the same manifest line, two commands are the same
 * command when they share an `id`, and two artifact globs are the same glob.
 * A single hardcoded key would have collapsed the artifact list to its first
 * entry, because a glob has no `evidence` field to compare.
 */
export function dedupeByKey<T>(items: readonly T[], identity: (item: T) => string): T[] {
  const seen = new Set<string>();
  const kept: T[] = [];
  for (const item of items) {
    const key = identity(item);
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(item);
  }
  return kept;
}

/** Sort key for a candidate list, so the proposal is stable across runs. */
export function byConfidenceThenId(
  left: Pick<CommandCandidate, 'confidence' | 'id'>,
  right: Pick<CommandCandidate, 'confidence' | 'id'>,
): number {
  if (left.confidence !== right.confidence) return right.confidence - left.confidence;
  return left.id.localeCompare(right.id);
}
