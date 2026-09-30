import type { ExecutionRun, RunPage, RunPageOptions } from './types.js';

/**
 * Run-list paging, shared by both store implementations.
 *
 * The listing is the dashboard's first request, and it was unbounded: every run
 * in the install's history, each with its tests and artifacts, each validated
 * through the canonical schema. A busy workspace turned one page load into the
 * whole table.
 *
 * The cursor is `createdAt|id` rather than either alone. The ordering is
 * **`createdAt DESC, id DESC`** — newest first — and a batch of runs can share a
 * creation time to the millisecond, so paging on the timestamp alone silently skips or
 * repeats rows, which is worse than not paging at all because it looks correct.
 *
 * **Newest-first is the direction, and it is not a preference.** The order was `ASC`,
 * which combined with a limit to serve the *oldest* N runs: once an install held more
 * runs than a page, the newest run was on no page, because the cursor walks the same way
 * as the order and could not turn round. `run-paging.test.ts` holds it.
 *
 * The array `pageRuns` is handed is already in serving order, so this module does not
 * sort — the two stores do, and `store-parity.test.ts` is what holds them to the same
 * answer.
 */

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

/** Encodes a run's paging position. */
export function encodeRunCursor(run: ExecutionRun): string {
  return Buffer.from(`${run.createdAt}|${run.id}`, 'utf8').toString('base64url');
}

/** Decodes a cursor, or `undefined` when it is not one we issued. */
export function decodeRunCursor(
  cursor: string | undefined,
): { createdAt: string; id: string } | undefined {
  if (cursor === undefined || cursor.trim() === '') return undefined;
  let decoded: string;
  try {
    decoded = Buffer.from(cursor, 'base64url').toString('utf8');
  } catch {
    return undefined;
  }
  const separator = decoded.indexOf('|');
  if (separator <= 0) return undefined;
  const createdAt = decoded.slice(0, separator);
  const id = decoded.slice(separator + 1);
  return id === '' ? undefined : { createdAt, id };
}

/** Clamps a requested page size into the supported range. */
export function normalizeRunLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_LIMIT;
  return Math.min(Math.max(Math.trunc(limit), 1), MAX_LIMIT);
}

const DEFAULT_EVENT_LIMIT = 100;
const MAX_EVENT_LIMIT = 500;

/**
 * Clamps an event page size.
 *
 * A separate range from the run listing, deliberately: events grow with the number
 * of **tests**, so a page of 100 runs' worth of events is a different quantity from
 * a page of 100 runs. Events are also mostly read as a *stream* — the dashboard polls
 * forward from the last sequence it saw — so the default is generous and the cap
 * exists for a caller that asks for the whole run.
 *
 * It lives here rather than in each store because the two stores must clamp
 * identically: a limit that means 500 in the Drizzle store and 100 in the in-memory
 * one would make the two disagree about what a page is, which is the drift the
 * shared scenario suite exists to catch and should not have to.
 */
export function normalizeEventLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_EVENT_LIMIT;
  return Math.min(Math.max(Math.trunc(limit), 1), MAX_EVENT_LIMIT);
}

/**
 * Applies a window to an already-ordered array of runs.
 *
 * `limit + 1` rows are taken so `hasMore` is known without a second count
 * query — the extra row is dropped before it reaches the caller.
 *
 * The cursor is resolved by **id first**, then by timestamp. Resolving by
 * timestamp alone is the bug this exists to avoid: a batch of runs can share a
 * creation time to the millisecond, so a cursor naming the second of two would
 * match the first and page between them forever. That failure looks like a
 * correct page that repeats, which is worse than no paging at all.
 */
export function pageRuns(
  ordered: readonly ExecutionRun[],
  options: RunPageOptions | undefined,
): RunPage {
  const limit = normalizeRunLimit(options?.limit);

  let from = 0;
  if (options?.after !== undefined && options.after.trim() !== '') {
    const cursor = decodeRunCursor(options.after);
    if (cursor === undefined) {
      // A cursor was supplied but is not one we issued. Treating it as *absent*
      // would silently restart from the first page, which a caller following
      // cursors would loop on forever — and a garbage string that happens to be
      // valid base64 decodes to nothing, so this is not hypothetical.
      return { runs: [], hasMore: false };
    }
    const byId = ordered.findIndex((run) => run.id === cursor.id);
    if (byId !== -1) {
      // `+1` in a **newest-first** array is the next *older* run, which is the direction
      // the cursor is meant to walk. Reversing the order without this staying at `+1`
      // would make page 2 repeat the rows page 1 already served.
      from = byId + 1;
    } else {
      // The cursor's run is gone (deleted, or filtered out of this workspace). Resume at
      // the first row *older* than its timestamp, and if there is none, return nothing
      // rather than silently restarting from the top.
      const older = ordered.findIndex((run) => run.createdAt < cursor.createdAt);
      if (older === -1) return { runs: [], hasMore: false };
      from = older;
    }
  }

  const slice = ordered.slice(from, from + limit + 1);
  const hasMore = slice.length > limit;
  return { runs: hasMore ? slice.slice(0, limit) : slice, hasMore };
}
