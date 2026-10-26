/**
 * The statistics every scorecard shares, in one place.
 *
 * Each scorer that compares two groups, ranks a percentile or calls a change significant
 * reads these, so "significant" means one thing across delivery, AI-code and eval gates.
 * Every function is pure and every random draw is seeded: the same input is the same
 * answer on every host, which is what makes a gate built on them reviewable.
 */

/** z for a two-sided 95% interval. */
export const Z_95 = 1.959963984540054;

export interface Interval {
  /** Point estimate. */
  estimate: number;
  low: number;
  high: number;
}

/**
 * Wilson score interval for a proportion `successes / trials`.
 *
 * Chosen over the normal approximation because it stays inside [0, 1] and behaves at the
 * edges (0 of 5, 5 of 5), which is exactly where small agent and eval samples live.
 * `null` when there are no trials: a rate over nothing is not zero.
 */
export function wilson(successes: number, trials: number, z: number = Z_95): Interval | null {
  if (!Number.isFinite(trials) || trials <= 0) return null;
  const k = Math.min(Math.max(successes, 0), trials);
  const p = k / trials;
  const z2 = z * z;
  const denominator = 1 + z2 / trials;
  const centre = (p + z2 / (2 * trials)) / denominator;
  const half = (z * Math.sqrt((p * (1 - p)) / trials + z2 / (4 * trials * trials))) / denominator;
  return {
    estimate: p,
    low: Math.max(0, centre - half),
    high: Math.min(1, centre + half),
  };
}

/**
 * Whether two proportions differ beyond noise: Newcombe's hybrid score interval for the
 * difference `a − b` (Newcombe 1998, method 10) excludes zero.
 *
 * Built from the two Wilson intervals, so it inherits their behaviour at the edges, but it
 * tests the *difference* — which is the question — rather than asking whether two separate
 * intervals overlap. Non-overlap is far stricter than a 95% test of the difference (roughly
 * p < 0.006), and it let a case falling from 9 of 10 to 3 of 10 pass as noise; this rule
 * calls that a regression and still calls 9 of 10 against 8 of 10 the same.
 *
 * Returns `'higher'` when `a` is credibly above `b`, `'lower'` when below, `'same'` when the
 * data cannot tell them apart, and `null` when either side has no trials.
 */
export function compareRates(
  a: { successes: number; trials: number },
  b: { successes: number; trials: number },
): 'higher' | 'lower' | 'same' | null {
  const difference = rateDifference(a, b);
  if (difference === null) return null;
  if (difference.low > 0) return 'higher';
  if (difference.high < 0) return 'lower';
  return 'same';
}

/** Newcombe's hybrid score interval for `rate(a) − rate(b)`; `null` without trials on both. */
export function rateDifference(
  a: { successes: number; trials: number },
  b: { successes: number; trials: number },
  z: number = Z_95,
): Interval | null {
  const left = wilson(a.successes, a.trials, z);
  const right = wilson(b.successes, b.trials, z);
  if (left === null || right === null) return null;
  const estimate = left.estimate - right.estimate;
  const below = Math.sqrt((left.estimate - left.low) ** 2 + (right.high - right.estimate) ** 2);
  const above = Math.sqrt((left.high - left.estimate) ** 2 + (right.estimate - right.low) ** 2);
  return {
    estimate,
    low: Math.max(-1, estimate - below),
    high: Math.min(1, estimate + above),
  };
}

/**
 * The `q`-th percentile (0–100) by linear interpolation between closest ranks.
 * `null` for an empty sample.
 */
export function percentile(values: readonly number[], q: number): number | null {
  const finite = values.filter((value) => Number.isFinite(value));
  if (finite.length === 0) return null;
  const sorted = [...finite].sort((left, right) => left - right);
  const clamped = Math.min(100, Math.max(0, q));
  const rank = (clamped / 100) * (sorted.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  const low = sorted[lower] as number;
  const high = sorted[upper] as number;
  return low + (high - low) * (rank - lower);
}

export function median(values: readonly number[]): number | null {
  return percentile(values, 50);
}

/** Mulberry32: a tiny, well-distributed, seedable PRNG. Not for anything secret. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A seeded bootstrap interval for the difference of means `mean(b) - mean(a)`.
 *
 * Used where outcomes are scores rather than pass/fail (an eval metric in [0, 1]).
 * `null` when either sample is empty.
 */
export function bootstrapMeanDifference(
  a: readonly number[],
  b: readonly number[],
  options: { seed: number; resamples?: number; confidence?: number },
): Interval | null {
  if (a.length === 0 || b.length === 0) return null;
  const random = seededRandom(options.seed);
  const resamples = options.resamples ?? 2000;
  const confidence = options.confidence ?? 0.95;
  const mean = (values: readonly number[]) =>
    values.reduce((sum, value) => sum + value, 0) / values.length;
  const draw = (values: readonly number[]) => {
    let sum = 0;
    for (let index = 0; index < values.length; index += 1) {
      sum += values[Math.floor(random() * values.length)] as number;
    }
    return sum / values.length;
  };
  const differences: number[] = [];
  for (let index = 0; index < resamples; index += 1) differences.push(draw(b) - draw(a));
  const tail = ((1 - confidence) / 2) * 100;
  return {
    estimate: mean(b) - mean(a),
    low: percentile(differences, tail) as number,
    high: percentile(differences, 100 - tail) as number,
  };
}
