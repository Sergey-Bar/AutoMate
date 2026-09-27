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
 * `createdAt ASC`, and a batch of runs can share a creation time to the
 * millisecond, so paging on the timestamp alone silently skips or repeats rows —
 * which is worse than not paging at all, because it looks correct.
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
      from = byId + 1;
    } else {
      // The cursor's run is gone (deleted, or filtered out of this workspace).
      // Resume at the first row strictly after its timestamp, and if there is
      // none, return nothing rather than silently restarting from the top.
      const after = ordered.findIndex((run) => run.createdAt > cursor.createdAt);
      if (after === -1) return { runs: [], hasMore: false };
      from = after;
    }
  }

  const slice = ordered.slice(from, from + limit + 1);
  const hasMore = slice.length > limit;
  return { runs: hasMore ? slice.slice(0, limit) : slice, hasMore };
}
