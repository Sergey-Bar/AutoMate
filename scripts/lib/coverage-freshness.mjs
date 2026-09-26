/**
 * Is a package's coverage summary the product of the code that is there now?
 *
 * The ratchet reads `<pkg>/coverage/coverage-summary.json`. That file is
 * gitignored, so it is whatever the last local run happened to leave behind. The
 * gate was reading it happily: a package could be deleted, rewritten, or
 * stripped of a module entirely and still "pass", because the numbers on disk
 * were produced by code that no longer exists.
 *
 * Turbo's cache makes this checkable rather than merely suspicious. The `test`
 * task declares `coverage/**` as an output, so a cache hit is only ever served
 * when the task's inputs hash is unchanged — meaning a restored summary always
 * describes the current inputs, whatever its mtime says. A summary that is
 * *older* than the newest input can therefore only have come from a run that did
 * not cover the current code, which is exactly the case worth failing on.
 *
 * Kept free of `node:fs` so the decision is testable without a fixture tree.
 */

/** @typedef {{ relativePath: string, summaryPath: string, summaryMtimeMs: number | null, newestInputMtimeMs: number | null }} CoverageFreshnessInput */

/**
 * @param {CoverageFreshnessInput} input
 * @returns {string | null} a finding to report, or null when the summary is fresh
 */
export function staleCoverageFinding(input) {
  const { relativePath, summaryPath, summaryMtimeMs, newestInputMtimeMs } = input;
  if (summaryMtimeMs === null) {
    return (
      `${relativePath}: ${summaryPath} is absent. Run this package's tests with ` +
      '--coverage before the ratchet; a summary from an earlier run proves nothing.'
    );
  }
  // No inputs means there is nothing to be stale against, and a package with no
  // source is a different defect the workspace scan already reports.
  if (newestInputMtimeMs === null) return null;
  if (summaryMtimeMs >= newestInputMtimeMs) return null;
  return (
    `${relativePath}: ${summaryPath} is older than the source it should describe. ` +
    'Re-run this package\'s tests with --coverage, or the ratchet is reading numbers ' +
    'from code that no longer exists.'
  );
}

/**
 * Directories never walked when looking for a package's newest input.
 *
 * `coverage` is the output being judged, and `node_modules`/`dist` are generated
 * from inputs rather than being inputs themselves; including them would make
 * every summary permanently stale the moment anything was installed or built.
 */
export const FRESHNESS_IGNORED_DIRECTORIES = new Set([
  '.turbo',
  'coverage',
  'dist',
  'node_modules',
]);
