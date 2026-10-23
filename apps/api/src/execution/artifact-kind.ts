/**
 * One mapping from whatever a caller called an artifact to what the column stores.
 *
 * A reporter says `raw_report`; a runner says `playwright-json`; the column says
 * `report` and `json`. The mapping is a contract, and finding P-57 records that it was
 * written out twice — byte-identically, in `drizzle-execution-store.ts` and
 * `in-memory-execution-store.ts`.
 *
 * That arrangement costs nothing today, which is the point worth stating: both copies
 * were the same function and both were correct. The cost is that the next person to
 * add a fourth spelling of a kind has two places to find, and the failure mode when
 * they find one is not a compile error — it is a store that classifies an artifact
 * differently from the other store, which surfaces as "some attachments are missing
 * from the filter" rather than as anything a test would have caught.
 *
 * **The fallback is `other` and not a refusal, and that is load-bearing.** A reporter
 * is allowed to ship evidence the platform has not been taught to label, and dropping
 * the upload would lose the very thing the product exists to keep. `other` stores it,
 * keeps it readable, and says honestly that the platform did not recognise the kind.
 * It is also what keeps this function inside the column's vocabulary:
 * `artifacts_kind_check` allows exactly twelve values
 * (`packages/db/src/schema/execution.ts:322`), and a passthrough would hand the
 * database a thirteenth. The CHECK remains the last word; this is simply no longer one
 * of the ways to reach it with something it will not hold.
 */
export function normalizeArtifactKind(value: string): string {
  return ARTIFACT_KINDS.get(value.toLowerCase()) ?? 'other';
}

/**
 * Every spelling a producer uses, and the column value it becomes. A `Map`, not an object
 * literal, because the key is a producer-supplied string and `constructor` must not resolve.
 *
 * `attachment` is an identity mapping, and the one entry here that `artifacts_kind_check`
 * forced. It was in the column's twelve-value vocabulary and had no branch in the function,
 * so it fell through to `other` — CHECK-valid, and lossy: the dashboard's attachment filter
 * could not match an attachment. The totality case in `artifact-kind.test.ts` is what found
 * it.
 */
const ARTIFACT_KINDS: ReadonlyMap<string, string> = new Map([
  ['raw_report', 'report'],
  ['report', 'report'],
  ['playwright-json', 'json'],
  ['json', 'json'],
  ['junit', 'junit'],
  ['stdout', 'stdout'],
  ['stderr', 'stderr'],
  ['screenshot', 'screenshot'],
  ['video', 'video'],
  ['trace', 'trace'],
  ['html', 'html'],
  ['html-report', 'html'],
  ['log', 'log'],
  ['event-log', 'log'],
  ['attachment', 'attachment'],
]);
