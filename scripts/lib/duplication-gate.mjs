/**
 * The decision `pnpm duplication` makes, kept free of `node:fs` so it can be
 * tested.
 *
 * The reason this module exists: `pnpm duplication` used to be `jscpd --config
 * .jscpd.json`, and that command analysed **zero files** while printing "Found 0
 * clones" and exiting 0. Every duplication number this repository has reported
 * was 0% because nothing was measured, not because the tree has no duplication.
 *
 * Two independent causes, both the same shape of problem:
 *
 *  - jscpd 5 validates its config strictly and rejected the whole file on the
 *    `$comment` key this config used to carry its own explanation. A comment key
 *    in a tool config is not a comment; the tool reads it as a typo in a setting.
 *  - jscpd 5 requires an explicit `format`, and no longer infers one from file
 *    extensions. Without it, `formats` resolves to `[]`, jscpd has no parser for
 *    any file, and again reports nothing.
 *
 * So the gate is now this module plus a wrapper, and the wrapper treats an empty
 * analysis as a failure. A duplication gate that cannot see the code is not a
 * passing gate, and "Found 0 clones" over zero files is the most convincing
 * possible false pass.
 */

/** The subset of jscpd's report this module needs. */
export const EMPTY_TOTAL = {
  clones: 0,
  duplicatedLines: 0,
  duplicatedTokens: 0,
  lines: 0,
  percentage: 0,
  percentageTokens: 0,
  sources: 0,
  tokens: 0,
};

/**
 * @param {unknown} report the parsed `jscpd-report.json`
 * @returns {typeof EMPTY_TOTAL}
 */
export function readTotals(report) {
  if (typeof report !== 'object' || report === null) return { ...EMPTY_TOTAL };
  const outer = /** @type {Record<string, unknown>} */ (report);
  const statistics = outer['statistics'];
  if (typeof statistics !== 'object' || statistics === null) return { ...EMPTY_TOTAL };
  const total = /** @type {Record<string, unknown>} */ (
    /** @type {Record<string, unknown>} */ (statistics)
  )['total'];
  if (typeof total !== 'object' || total === null) return { ...EMPTY_TOTAL };
  const fields = /** @type {Record<string, unknown>} */ (total);
  /** @param {unknown} value */
  const number = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
  return {
    clones: number(fields['clones']),
    duplicatedLines: number(fields['duplicatedLines']),
    duplicatedTokens: number(fields['duplicatedTokens']),
    lines: number(fields['lines']),
    percentage: number(fields['percentage']),
    percentageTokens: number(fields['percentageTokens']),
    sources: number(fields['sources']),
    tokens: number(fields['tokens']),
  };
}

/**
 * What the gate concluded.
 *
 * @param {{ totals: typeof EMPTY_TOTAL, threshold: number, exitStatus: number | null, stderr: string }} input
 * @returns {{ outcome: 'pass' | 'fail' | 'not_configured', message: string }}
 */
export function duplicationVerdict(input) {
  const { totals, threshold } = input;

  // jscpd exits 0 both when it measured a clean tree and when it measured nothing,
  // so the exit status cannot be the signal. The file count can.
  if (totals.sources === 0) {
    return {
      outcome: 'fail',
      message:
        'Duplication gate: jscpd analysed 0 files, so the 0% it reports is a ' +
        'measurement of nothing, not of this repository. Check the `format` and ' +
        '`pattern` settings in .jscpd.json, and the paths passed on the command ' +
        'line. A gate that cannot see the code has not passed.',
    };
  }

  if (totals.percentage > threshold) {
    return {
      outcome: 'fail',
      message:
        `Duplication ${totals.percentage.toFixed(2)}% exceeds the ${threshold}% ` +
        `budget: ${totals.clones} clone(s) over ${totals.duplicatedLines} of ` +
        `${totals.lines} lines across ${totals.sources} files.`,
    };
  }

  if (input.exitStatus !== 0) {
    return {
      outcome: 'fail',
      message:
        `Duplication gate: jscpd exited ${input.exitStatus} but reported ` +
        `${totals.percentage.toFixed(2)}%, which is within budget. A non-zero exit ` +
        'with an in-budget number usually means the scan itself failed.',
    };
  }

  return {
    outcome: 'pass',
    message:
      `Duplication ${totals.percentage.toFixed(2)}% of ${totals.lines} lines ` +
      `across ${totals.sources} files, within the ${threshold}% budget ` +
      `(${totals.clones} clone(s)).`,
  };
}

/**
 * jscpd is not installed, so nothing was measured. Non-zero, and named.
 *
 * @param {string} binary
 * @returns {{ outcome: 'not_configured', message: string }}
 */
export function notConfiguredVerdict(binary) {
  return {
    outcome: 'not_configured',
    message:
      `Duplication: not_configured — ${binary} is not installed, so no file was ` +
      'measured. Install the pinned devDependency, or run this on a host that has ' +
      'it. This is not a pass.',
  };
}
