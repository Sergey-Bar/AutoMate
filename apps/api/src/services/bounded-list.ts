/**
 * Lists that go into `inArray`, with their bound stated at the call.
 *
 * `no-unbounded-list-in-query` reads a bare identifier passed to `inArray` as "a list whose
 * length the caller chose", and it is right to: a statement whose parameter count is set by
 * whoever built the list is a statement the planner cannot plan. The remedy is a bound a
 * reader can see — `inArray(column, withinBound(ids, MAX_DEPLOYMENTS))` — enforced by a
 * function that throws, so a removed cap or chunk becomes a red test rather than a silently
 * unbounded query. The same shape as `oneBatchOf` in `repositories/drizzle-run-repository.ts`.
 */

function assertPositiveInteger(value: number, what: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`${what} was ${String(value)}; it must be a positive integer.`);
  }
}

/** A copy of `values`, asserted to hold at most `bound` entries. Never truncates. */
export function withinBound<T>(values: readonly T[], bound: number): T[] {
  assertPositiveInteger(bound, 'The bound');
  if (values.length > bound) {
    throw new RangeError(
      `withinBound was given ${String(values.length)} values, over the bound of ` +
        `${String(bound)}. The caller must cap or chunk the list before the query.`,
    );
  }
  return [...values];
}

/** `values` in order, in chunks of at most `size`; none for an empty list. */
export function inChunksOf<T>(values: readonly T[], size: number): T[][] {
  assertPositiveInteger(size, 'The chunk size');
  const chunks: T[][] = [];
  for (let at = 0; at < values.length; at += size) chunks.push(values.slice(at, at + size));
  return chunks;
}
