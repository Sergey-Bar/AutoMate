import type { Scorecard, ScorecardMetric } from '@automate/shared-contracts';
import { median, percentile, wilson, type Interval } from './stats.js';

/**
 * Pull-request flow: where a change waits between its first commit and production.
 *
 * Aggregated at repository level only. Nothing here ranks, scores or lists people: the
 * inputs carry no author, and the bus-factor output carries counts, never names. Per-person
 * productivity ranking is out of scope by design — it measures the wrong unit (delivery is
 * a team property; DORA itself warns against league tables), it is trivially gamed by
 * splitting work, and a dashboard that can rank individuals will be used to. Flow metrics
 * are for finding the queue a change sits in, which is a property of the process.
 *
 * Everything here is pure: the clock is the injected `now`.
 */

export interface FlowPullRequest {
  number: number;
  state: 'open' | 'closed' | 'merged';
  draft: boolean;
  createdAt: string;
  firstCommitAt: string | null;
  firstReviewAt: string | null;
  approvedAt: string | null;
  mergedAt: string | null;
  closedAt: string | null;
  deployedAt: string | null;
  lastActivityAt: string;
  additions: number;
  deletions: number;
  reviewCount: number;
  approvals: number;
}

/** A duration sample, summarised. Every field but `sampleSize` is `null` for no sample. */
export interface FlowDuration {
  medianHours: number | null;
  p75Hours: number | null;
  minHours: number | null;
  maxHours: number | null;
  sampleSize: number;
}

export const FLOW_SIZE_BUCKETS = ['XS', 'S', 'M', 'L', 'XL'] as const;
export type FlowSizeBucket = (typeof FLOW_SIZE_BUCKETS)[number];

/** Upper bound, inclusive, of each bucket in changed lines. Above `L` is `XL`. */
export const FLOW_SIZE_LIMITS = { XS: 10, S: 100, M: 400, L: 1000 } as const;

export interface FlowResult {
  windowDays: number;
  staleAfterDays: number;
  /** Pull requests merged in the window: the population of the cycle time and sizes. */
  merged: number;
  cycleTime: {
    /** First commit → opened. 0 when the pull request was opened before the first commit. */
    coding: FlowDuration;
    /** Opened → first review. */
    pickup: FlowDuration;
    /** First review → merged. */
    review: FlowDuration;
    /** Merged → deployed. */
    deploy: FlowDuration;
  };
  /** Opened → first review, for every non-draft pull request first reviewed in the window. */
  reviewLatency: FlowDuration;
  /** How many of the review-latency samples were within one day. */
  firstReviewWithinDay: { count: number; total: number };
  sizes: Record<FlowSizeBucket, number>;
  /** Open, non-draft pull requests now. */
  workInProgress: number;
  /** Open, non-draft and idle at least `staleAfterDays`, longest idle first. */
  stale: readonly { number: number; daysIdle: number }[];
  mergedWithoutReview: { count: number; merged: number; rate: Interval | null };
}

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
/** Google's code review guidance: one business day is the maximum time to first response. */
export const FLOW_REVIEW_RESPONSE_HOURS = 24;

/** The bucket for a pull request of `changedLines` (additions + deletions). */
export function sizeBucket(changedLines: number): FlowSizeBucket {
  if (changedLines <= FLOW_SIZE_LIMITS.XS) return 'XS';
  if (changedLines <= FLOW_SIZE_LIMITS.S) return 'S';
  if (changedLines <= FLOW_SIZE_LIMITS.M) return 'M';
  if (changedLines <= FLOW_SIZE_LIMITS.L) return 'L';
  return 'XL';
}

const parse = (iso: string | null) => (iso === null ? Number.NaN : Date.parse(iso));

/** Hours from `from` to `to`; `null` when either is missing or unparseable. */
function hoursBetween(from: string | null, to: string | null): number | null {
  const hours = (parse(to) - parse(from)) / HOUR_MS;
  return Number.isFinite(hours) ? hours : null;
}

function summarise(sample: readonly number[]): FlowDuration {
  if (sample.length === 0) {
    return { medianHours: null, p75Hours: null, minHours: null, maxHours: null, sampleSize: 0 };
  }
  return {
    medianHours: median(sample),
    p75Hours: percentile(sample, 75),
    minHours: Math.min(...sample),
    maxHours: Math.max(...sample),
    sampleSize: sample.length,
  };
}

/** Collects non-negative durations: a negative one is clock skew, not a fast review. */
function collect(
  prs: readonly FlowPullRequest[],
  duration: (pr: FlowPullRequest) => number | null,
): number[] {
  return prs.flatMap((pr) => {
    const hours = duration(pr);
    return hours !== null && hours >= 0 ? [hours] : [];
  });
}

/**
 * Repository flow over `[now - windowDays, now]`.
 *
 * Medians and 75th percentiles rather than means: review queues are long-tailed, and the
 * p75 is where "most changes wait about this long" stops being true. Coding time is the
 * one phase clamped at zero rather than dropped when negative, because opening a pull
 * request before the first commit is a normal way to work, and its pre-opening coding
 * time is genuinely zero; a review before opening or a deploy before merging is skew.
 *
 * Review latency differs from pickup in its population: pickup is over what merged,
 * latency is over every non-draft pull request first reviewed in the window, so a queue
 * of abandoned, never-merged work still shows.
 */
export function computeFlow(
  prs: readonly FlowPullRequest[],
  options: { now: Date; windowDays: number; staleAfterDays?: number },
): FlowResult {
  if (!Number.isFinite(options.windowDays) || options.windowDays <= 0) {
    throw new RangeError(`windowDays must be a positive number, got ${options.windowDays}`);
  }
  const staleAfterDays = options.staleAfterDays ?? 7;
  const end = options.now.getTime();
  const start = end - options.windowDays * DAY_MS;
  const inWindow = (iso: string | null) => {
    const at = parse(iso);
    return at >= start && at <= end;
  };

  const merged = prs.filter((pr) => pr.state === 'merged' && inWindow(pr.mergedAt));
  const coding = merged.flatMap((pr) => {
    const hours = hoursBetween(pr.firstCommitAt, pr.createdAt);
    return hours === null ? [] : [Math.max(0, hours)];
  });
  const latency = collect(
    prs.filter((pr) => !pr.draft && inWindow(pr.firstReviewAt)),
    (pr) => hoursBetween(pr.createdAt, pr.firstReviewAt),
  );

  const sizes: Record<FlowSizeBucket, number> = { XS: 0, S: 0, M: 0, L: 0, XL: 0 };
  for (const pr of merged) sizes[sizeBucket(pr.additions + pr.deletions)] += 1;

  const open = prs.filter((pr) => pr.state === 'open' && !pr.draft);
  const stale = open
    .flatMap((pr) => {
      const idle = (end - parse(pr.lastActivityAt)) / DAY_MS;
      return idle >= staleAfterDays ? [{ number: pr.number, daysIdle: Math.floor(idle) }] : [];
    })
    .sort((left, right) => right.daysIdle - left.daysIdle || left.number - right.number);

  const unreviewed = merged.filter((pr) => pr.reviewCount === 0).length;
  return {
    windowDays: options.windowDays,
    staleAfterDays,
    merged: merged.length,
    cycleTime: {
      coding: summarise(coding),
      pickup: summarise(collect(merged, (pr) => hoursBetween(pr.createdAt, pr.firstReviewAt))),
      review: summarise(collect(merged, (pr) => hoursBetween(pr.firstReviewAt, pr.mergedAt))),
      deploy: summarise(collect(merged, (pr) => hoursBetween(pr.mergedAt, pr.deployedAt))),
    },
    reviewLatency: summarise(latency),
    firstReviewWithinDay: {
      count: latency.filter((hours) => hours <= FLOW_REVIEW_RESPONSE_HOURS).length,
      total: latency.length,
    },
    sizes,
    workInProgress: open.length,
    stale,
    mergedWithoutReview: {
      count: unreviewed,
      merged: merged.length,
      rate: wilson(unreviewed, merged.length),
    },
  };
}

// ─── Bus factor ─────────────────────────────────────────────────────────────

export interface AuthorshipEntry {
  path: string;
  author: string;
  commits: number;
}

export interface CodeownersRule {
  pattern: string;
  owners: readonly string[];
}

export interface DirectoryBusFactor {
  /** The top-level directory, or `.` for files at the repository root. */
  directory: string;
  authorCount: number;
  /** The fewest authors whose commits together reach half the directory's commits. */
  busFactor: number;
  commits: number;
  /** Whether CODEOWNERS owns every authored path in it; `null` with no CODEOWNERS file. */
  codeowned: boolean | null;
}

const escapeRegExp = (character: string) => character.replace(/[.+^${}()|[\]\\]/gu, '\\$&');

/**
 * Whether a CODEOWNERS pattern matches a path, by the gitignore rules CODEOWNERS uses.
 *
 * The supported subset: a leading `/` or a slash inside the pattern anchors it at the root,
 * otherwise it matches at any depth; a trailing `/` matches only the contents of a
 * directory; `*` and `?` stay within one segment; `**` crosses segments; a pattern naming
 * a directory also matches everything under it. Character classes and `!` negation are
 * not supported — GitHub does not support negation in CODEOWNERS either. Comments, blank
 * lines and a bare `/` match nothing.
 */
export function codeownersMatches(pattern: string, path: string): boolean {
  const trimmed = pattern.trim();
  if (trimmed === '' || trimmed.startsWith('#')) return false;
  const anchored = trimmed.startsWith('/') || trimmed.replace(/\/+$/u, '').includes('/');
  const directoryOnly = trimmed.endsWith('/');
  const body = trimmed.replace(/^\/+/u, '').replace(/\/+$/u, '');
  if (body === '') return false;
  const prefix = anchored ? '' : '(?:.*/)?';
  const suffix = directoryOnly ? '/.*' : '(?:/.*)?';
  return new RegExp(`^${prefix}${globSource(body)}${suffix}$`, 'u').test(path);
}

/** The single-segment wildcards; `**` is handled before these are consulted. */
const GLOB_CHARACTERS: ReadonlyMap<string, string> = new Map([
  ['*', '[^/]*'],
  ['?', '[^/]'],
]);

/**
 * The regular-expression source of a pattern body: `*` and `?` stay within one segment,
 * `**` crosses segments, and every other character is literal.
 */
function globSource(body: string): string {
  let source = '';
  for (let index = 0; index < body.length; index += 1) {
    const character = body[index] as string;
    if (character === '*' && body[index + 1] === '*') {
      const crossesSlash = body[index + 2] === '/';
      source += crossesSlash ? '(?:.*/)?' : '.*';
      index += crossesSlash ? 2 : 1;
    } else {
      source += GLOB_CHARACTERS.get(character) ?? escapeRegExp(character);
    }
  }
  return source;
}

const normalisePath = (path: string) => path.replace(/\\/gu, '/').replace(/^(?:\.\/|\/)+/u, '');
const topLevel = (path: string) => {
  const slash = path.indexOf('/');
  return slash === -1 ? '.' : path.slice(0, slash);
};

/** Last matching rule wins, and a rule with no owners un-owns the path. */
function isOwned(path: string, codeowners: readonly CodeownersRule[]): boolean {
  let owned = false;
  for (const rule of codeowners) {
    if (codeownersMatches(rule.pattern, path)) owned = rule.owners.length > 0;
  }
  return owned;
}

/**
 * Per top-level directory: how many people would have to leave before nobody who wrote
 * most of it remains, and whether CODEOWNERS names an owner for it.
 *
 * "Most" is the conventional half: the fewest authors, taken in descending order of
 * commits, whose commits reach at least 50% of the directory's. Rows with no positive
 * commits are ignored, so a directory nobody committed to is absent rather than a bus
 * factor of zero. Author names are used only to group rows and never leave this
 * function, so the output cannot be turned into a per-person ranking.
 */
export function busFactor(
  authorship: readonly AuthorshipEntry[],
  codeowners: readonly CodeownersRule[] | null,
): DirectoryBusFactor[] {
  const directories = new Map<string, { authors: Map<string, number>; paths: Set<string> }>();
  for (const row of authorship) {
    if (!(row.commits > 0)) continue;
    const path = normalisePath(row.path);
    const directory = topLevel(path);
    const entry = directories.get(directory) ?? { authors: new Map(), paths: new Set() };
    entry.authors.set(row.author, (entry.authors.get(row.author) ?? 0) + row.commits);
    entry.paths.add(path);
    directories.set(directory, entry);
  }
  return [...directories.entries()]
    .sort(([left], [right]) => Number(left > right) - Number(left < right))
    .map(([directory, { authors, paths }]) => {
      const counts = [...authors.values()].sort((left, right) => right - left);
      const total = counts.reduce((sum, count) => sum + count, 0);
      let covered = 0;
      let factor = 0;
      while (covered * 2 < total) {
        covered += counts[factor] as number;
        factor += 1;
      }
      return {
        directory,
        authorCount: counts.length,
        busFactor: factor,
        commits: total,
        codeowned:
          codeowners === null ? null : [...paths].every((path) => isOwned(path, codeowners)),
      };
    });
}

// ─── Scorecard ──────────────────────────────────────────────────────────────

/**
 * Status cut-offs for the flow shares. These are this module's convention, not an
 * industry benchmark — no published standard exists for, say, the share of reviewed
 * merges — so they are one named constant a reader can disagree with in one place.
 */
export const FLOW_SHARE_STATUS = { good: 0.9, warn: 0.75 } as const;

const shareStatus = (value: number): ScorecardMetric['status'] =>
  value >= FLOW_SHARE_STATUS.good ? 'good' : value >= FLOW_SHARE_STATUS.warn ? 'warn' : 'bad';

const percent = (value: number) => `${Math.round(value * 1000) / 10}%`;

/**
 * The flow scorecard.
 *
 * The score is the geometric mean of four shares — first reviews within a day, merges
 * that were reviewed, merged pull requests of at most `M` size, and open work that is not
 * stale — so it rests on proportions of observed pull requests rather than on time
 * thresholds we would have to invent; `cappedBy` names the lowest share. Review latency is
 * shown beside them, judged against Google's one-business-day guidance, and is not scored
 * twice. A share over fewer than `minSample` pull requests (default 5) is `insufficient`.
 *
 * Flow has no policy to fail against: it diagnoses where work waits, and a card that
 * failed a build on review speed would be a target, which is what Goodhart's law warns
 * about. It is `pass` with a score, or `insufficient` when no share is measured.
 */
export function flowScorecard(
  result: FlowResult,
  options: { now: Date; windowDays: number; minSample?: number },
): Scorecard {
  const minSample = Math.max(1, Math.floor(options.minSample ?? 5));
  const insufficient = (sampleSize: number) =>
    `${sampleSize} of the ${minSample} pull requests needed.`;

  const latency = result.reviewLatency;
  const latencyMetric: ScorecardMetric =
    latency.medianHours === null || latency.sampleSize < minSample
      ? {
          key: 'review-latency',
          label: 'Time to first review (median)',
          value: null,
          unit: 'hours',
          direction: 'lower-better',
          target: FLOW_REVIEW_RESPONSE_HOURS,
          trend: null,
          sampleSize: latency.sampleSize,
          band: null,
          status: 'insufficient',
          summary: insufficient(latency.sampleSize),
        }
      : {
          key: 'review-latency',
          label: 'Time to first review (median)',
          value: latency.medianHours,
          unit: 'hours',
          direction: 'lower-better',
          target: FLOW_REVIEW_RESPONSE_HOURS,
          trend: null,
          sampleSize: latency.sampleSize,
          band: null,
          status:
            latency.medianHours > FLOW_REVIEW_RESPONSE_HOURS
              ? 'bad'
              : (latency.p75Hours as number) > FLOW_REVIEW_RESPONSE_HOURS
                ? 'warn'
                : 'good',
          summary: `Median ${Math.round(latency.medianHours * 10) / 10} h, p75 ${
            Math.round((latency.p75Hours as number) * 10) / 10
          } h to first review.`,
        };

  const shares: { key: string; label: string; part: number; whole: number; what: string }[] = [
    {
      key: 'first-review-within-a-day',
      label: 'First reviews within one day',
      part: result.firstReviewWithinDay.count,
      whole: result.firstReviewWithinDay.total,
      what: 'first reviews arrived within 24 hours',
    },
    {
      key: 'reviewed-before-merge',
      label: 'Merged after review',
      part: result.merged - result.mergedWithoutReview.count,
      whole: result.merged,
      what: 'merged pull requests had a review',
    },
    {
      key: 'small-pull-requests',
      label: `Merged pull requests of at most ${FLOW_SIZE_LIMITS.M} lines`,
      part: result.sizes.XS + result.sizes.S + result.sizes.M,
      whole: result.merged,
      what: `merged pull requests changed at most ${FLOW_SIZE_LIMITS.M} lines`,
    },
    {
      key: 'fresh-work-in-progress',
      label: 'Open work that is not stale',
      part: result.workInProgress - result.stale.length,
      whole: result.workInProgress,
      what: `open pull requests had activity in the last ${result.staleAfterDays} days`,
    },
  ];

  const scored: { key: string; value: number }[] = [];
  const shareMetrics: ScorecardMetric[] = shares.map((share) => {
    const base = {
      key: share.key,
      label: share.label,
      unit: 'ratio' as const,
      direction: 'higher-better' as const,
      target: FLOW_SHARE_STATUS.good,
      trend: null,
      sampleSize: share.whole,
      band: null,
    };
    if (share.whole < minSample) {
      return { ...base, value: null, status: 'insufficient', summary: insufficient(share.whole) };
    }
    const value = share.part / share.whole;
    scored.push({ key: share.key, value });
    return {
      ...base,
      value,
      status: shareStatus(value),
      summary: `${share.part} of ${share.whole} ${share.what} (${percent(value)}).`,
    };
  });

  const common = {
    id: 'flow' as const,
    title: 'Pull-request flow',
    dimension: 'delivery' as const,
    evaluatedAt: options.now.toISOString(),
    windowDays: options.windowDays,
    metrics: [latencyMetric, ...shareMetrics],
    reasons: [],
  };
  if (scored.length === 0) {
    return { ...common, status: 'insufficient', score: null, cappedBy: null };
  }
  // A zero share makes the product zero, which is the point: it cannot be averaged away.
  const product = scored.reduce((acc, entry) => acc * entry.value, 1);
  const score = 100 * product ** (1 / scored.length);
  const worst = scored.reduce((low, entry) => (entry.value < low.value ? entry : low));
  return {
    ...common,
    status: 'pass',
    score: Math.round(score * 10) / 10,
    cappedBy: worst.key,
  };
}
