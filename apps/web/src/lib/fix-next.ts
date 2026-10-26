import type { FixNext, HealthGrade, Scorecard } from '@automate/shared-contracts';
import { dimensionLabel } from './health-view.js';

/**
 * One "fix next" list for a repository, from the grade and from every scorecard beside it.
 *
 * ## Two sources, and which one leads
 *
 * The grade's `fixNext` is ranked by the server by what fixing each item is worth to the
 * overall score — a measured `gain`. That order is kept as it arrived: re-ranking it here
 * would be a second authority on the same question. A failing scorecard's reasons carry no
 * gain at all, so they cannot be placed among the grade's items by value; they follow them,
 * the lowest-scoring scorecard first (an unscored one last), each card's reasons in the
 * order the server wrote them. The same sentence from two places is listed once.
 */
export interface FixNextItem {
  key: string;
  title: string;
  /** Where the item came from: the grade, or the scorecard's title. */
  source: string;
  /** Points of overall score, for a grade item. `null` for a scorecard reason. */
  gain: number | null;
  /** Where to act on it. */
  href: string;
}

export interface ScorecardSource {
  scorecard: Scorecard;
  href: string;
}

function gradeItem(item: FixNext, gradeHref: string): FixNextItem {
  return {
    key: item.key,
    title: item.title,
    source: `Grade · ${dimensionLabel(item.dimension)}`,
    gain: item.gain,
    href: item.helpUri ?? gradeHref,
  };
}

function scoreRank(card: Scorecard): number {
  return card.score ?? Number.POSITIVE_INFINITY;
}

function scorecardItems(sources: readonly ScorecardSource[]): FixNextItem[] {
  return sources
    .filter((source) => source.scorecard.status === 'fail')
    .slice()
    .sort((left, right) => scoreRank(left.scorecard) - scoreRank(right.scorecard))
    .flatMap(({ scorecard, href }) =>
      scorecard.reasons.map((reason, index) => ({
        key: `scorecard:${scorecard.id}:${scorecard.title}:${String(index)}`,
        title: reason,
        source: scorecard.title,
        gain: null,
        href,
      })),
    );
}

export function rankFixNext(
  grade: Pick<HealthGrade, 'fixNext'> | null,
  scorecards: readonly ScorecardSource[],
  options: { gradeHref: string; limit?: number },
): FixNextItem[] {
  const merged = [
    ...(grade?.fixNext ?? []).map((item) => gradeItem(item, options.gradeHref)),
    ...scorecardItems(scorecards),
  ];
  const seen = new Set<string>();
  const unique = merged.filter((item) => {
    const identity = item.title.trim().toLowerCase();
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
  return unique.slice(0, options.limit ?? 8);
}
