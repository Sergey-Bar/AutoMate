/**
 * Which files each CI shard runs, so the shards finish together.
 *
 * Playwright's own `--shard i/n` splits by position, so one shard gets the three slow
 * checkout specs and finishes ten minutes after the others. This splits by **time**: each
 * file is estimated at the median of what it took in recent runs, and the files are dealt
 * longest first, each to the shard with the least work so far (LPT). That bounds the slowest
 * shard at the average plus one file (SHARD-2).
 *
 * **The caller names the files, and every one of them is planned** (SHARD-1). A planner that
 * planned only the files it had history for would drop every new spec on the floor, which is
 * a test that silently never runs. A file with no history is estimated at the median of the
 * files that have one — a new spec is an ordinary spec until it says otherwise — and at 1 ms
 * when nothing has history, which degrades to an even split by name.
 *
 * **The plan is a function of the set of files** (SHARD-3): each shard calls separately, and
 * two shards that listed the files in a different order must still get one plan between them,
 * or a file lands in neither.
 *
 * **A requested path matches its history by path suffix.** A report names a file relative to
 * the runner's root (`checkout/pay.spec.ts`), CI names it relative to the repository
 * (`e2e/checkout/pay.spec.ts`), and both are the same file. The longest history path the
 * requested one ends with, on a `/` boundary, wins.
 */

export interface ShardPlanInput {
  /** How many shards. */
  total: number;
  /** The files to plan, as CI names them. Duplicates are one file. */
  files: readonly string[];
  /** Per history path, the time the file took in each recent run, in ms. */
  history: ReadonlyMap<string, readonly number[]>;
}

export interface PlannedShard {
  /** 1-based, as Playwright's `--shard` and every CI matrix count. */
  index: number;
  /** Sorted, so the output is the same bytes whichever shard prints it. */
  files: string[];
  estimatedMs: number;
}

export interface ShardPlan {
  shards: PlannedShard[];
  /** The estimate each file was planned with. */
  estimates: Record<string, number>;
  /** How many files had history, and how many were estimated without it. */
  known: number;
  unknown: number;
}

/** What a file is estimated at when no file has history. */
const NO_HISTORY_MS = 1;

/** The median, rounded to a whole ms; 0 for no values. */
function medianMs(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length === 0) return 0;
  return sorted.length % 2 === 1
    ? (sorted[middle] ?? 0)
    : Math.round(((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2);
}

/** The history of the longest path `file` ends with, on a `/` boundary. */
function historyFor(
  file: string,
  history: ReadonlyMap<string, readonly number[]>,
): readonly number[] | undefined {
  let suffix = file;
  for (;;) {
    const found = history.get(suffix);
    if (found !== undefined && found.length > 0) return found;
    const slash = suffix.indexOf('/');
    if (slash === -1) return undefined;
    suffix = suffix.slice(slash + 1);
  }
}

/** Each file's estimate: its own median, or the median of those that have one. */
function estimateFiles(
  files: readonly string[],
  history: ReadonlyMap<string, readonly number[]>,
): { estimates: Record<string, number>; known: number } {
  const measured = new Map<string, number>();
  for (const file of files) {
    const durations = historyFor(file, history);
    if (durations !== undefined) measured.set(file, medianMs(durations));
  }
  const fallback = measured.size === 0 ? NO_HISTORY_MS : medianMs([...measured.values()]);
  const estimates: Record<string, number> = {};
  for (const file of files) estimates[file] = measured.get(file) ?? fallback;
  return { estimates, known: measured.size };
}

/** Longest first, each file to the least-loaded shard (the lowest index on a tie). */
function dealFiles(
  files: readonly string[],
  estimates: Readonly<Record<string, number>>,
  total: number,
): PlannedShard[] {
  const shards: PlannedShard[] = Array.from({ length: total }, (_, index) => ({
    index: index + 1,
    files: [],
    estimatedMs: 0,
  }));
  const order = [...files].sort(
    (left, right) => (estimates[right] ?? 0) - (estimates[left] ?? 0) || (left < right ? -1 : 1),
  );
  for (const file of order) {
    const target = shards.reduce((least, shard) =>
      shard.estimatedMs < least.estimatedMs ? shard : least,
    );
    target.files.push(file);
    target.estimatedMs += estimates[file] ?? 0;
  }
  for (const shard of shards) shard.files.sort();
  return shards;
}

export function planShards(input: ShardPlanInput): ShardPlan {
  const total = Math.max(1, Math.floor(input.total));
  const files = [...new Set(input.files)].sort();
  const { estimates, known } = estimateFiles(files, input.history);
  return {
    shards: dealFiles(files, estimates, total),
    estimates,
    known,
    unknown: files.length - known,
  };
}
