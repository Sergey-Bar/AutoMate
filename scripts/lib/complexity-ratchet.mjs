/**
 * The comparison `scripts/complexity-gate.mjs` makes between what it measured and what the
 * baseline recorded, kept apart from the script so it can be tested without running ESLint.
 *
 * **What this replaces, and why.** The gate used to compare the *number of files* holding an
 * offender: `offendersByFile.size > recordedFiles.size`. That is a count of distinct files, not
 * of offenders, so it passed three ways it should not have:
 *
 *  - a file that already held one offender gained a second (the file count is unchanged);
 *  - a new offender appeared in a file while a different file's offender was fixed (one file in,
 *    one file out, the sizes equal);
 *  - an offender in a recorded file got *worse*, which no count sees at all.
 *
 * Per file rather than per line is still the unit, for the reason the gate always gave: keying by
 * line made any edit above a long function look like new complexity. So each file's offender
 * count may not exceed the recorded one, and a file the baseline does not mention may hold none.
 */

/**
 * @typedef {{ file: string, line?: number, complexity: number | null }} Offender
 */

/**
 * @param {readonly Offender[]} offenders
 * @returns {Map<string, number>}
 */
export function countByFile(offenders) {
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const row of offenders) counts.set(row.file, (counts.get(row.file) ?? 0) + 1);
  return counts;
}

/**
 * The files that now hold more offenders than the baseline recorded, with both counts.
 *
 * @param {readonly Offender[]} measured
 * @param {readonly Offender[]} recorded
 * @returns {Array<{ file: string, recorded: number, measured: number }>}
 */
export function grownFiles(measured, recorded) {
  const before = countByFile(recorded);
  return [...countByFile(measured).entries()]
    .filter(([file, count]) => count > (before.get(file) ?? 0))
    .map(([file, count]) => ({ file, recorded: before.get(file) ?? 0, measured: count }));
}

/**
 * Whether the worst offender got worse than the baseline recorded. A function can grow from 16
 * to 40 without any count changing, and that is the regression a refactor-toward-10 programme
 * most needs to see.
 *
 * @param {readonly Offender[]} measured
 * @param {number | undefined} recordedWorst
 * @returns {number | null} the new worst, or null when it did not grow
 */
export function worsenedTo(measured, recordedWorst) {
  const worst = Math.max(0, ...measured.map((row) => row.complexity ?? 0));
  return recordedWorst !== undefined && worst > recordedWorst ? worst : null;
}
