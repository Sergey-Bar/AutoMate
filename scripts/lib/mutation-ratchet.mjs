/**
 * The mutation ratchet: a mutation score may go up, never down.
 *
 * Same semantics as `coverage-ratchet.mjs` + `coverage-floor-ratchet.mjs`, for the one
 * question coverage cannot answer - "would the tests notice if this line were wrong?".
 *
 *  - a measured score below the recorded floor fails;
 *  - a recorded floor lower than the one at the base commit fails, because lowering the
 *    floor and lowering the score have the same effect on the verdict and only one of
 *    them is a defect;
 *  - an unreadable, empty or malformed baseline fails CLOSED, because "no baseline" read
 *    as "nothing to compare" is a gate that cannot fail;
 *  - a package with no measurement fails; it is never skipped;
 *  - a new package enters the baseline only through `recordScores`, which the script
 *    calls only under `--record` - deliberate, never as a side effect of a run.
 *
 * Dependency-free and pure: the script owns the filesystem and git.
 */

/** The five packages roadmap section 17 point 5 names. */
export const MUTATION_PACKAGES = Object.freeze([
  'packages/shared-contracts',
  'packages/reporting',
  'packages/auth',
  'packages/orchestration',
  'packages/runner-sdk',
]);

/** Roadmap section 17 point 5. */
export const MUTATION_TARGET = 75;

/**
 * @typedef {{ score: number, measuredOn: string, killed?: number, timeout?: number,
 *   survived?: number, noCoverage?: number }} MutationEntry
 * @typedef {{ target: number, packages: Record<string, MutationEntry> }} MutationBaseline
 */

/**
 * The score of one Stryker `mutation.json` report.
 *
 * Stryker's definition: detected (Killed + Timeout) over valid (detected + Survived +
 * NoCoverage). Ignored, CompileError and RuntimeError mutants are not valid. Floored at
 * two decimals so a recorded floor is never above what was measured.
 *
 * @param {unknown} report
 * @returns {{ score: number, killed: number, timeout: number, survived: number, noCoverage: number }}
 */
export function mutationScore(report) {
  if (typeof report !== 'object' || report === null) {
    throw new Error('not a mutation report: expected a JSON object');
  }
  const files =
    /** @type {{ files?: Record<string, { mutants?: Array<{ status?: string }> }> }} */ (report)
      .files;
  const counts = { Killed: 0, Timeout: 0, Survived: 0, NoCoverage: 0 };
  for (const file of Object.values(files ?? {})) {
    for (const mutant of file.mutants ?? []) {
      const status = mutant.status ?? '';
      if (status in counts) counts[/** @type {keyof typeof counts} */ (status)] += 1;
    }
  }
  const detected = counts.Killed + counts.Timeout;
  const valid = detected + counts.Survived + counts.NoCoverage;
  if (valid === 0) {
    throw new Error('the report holds no valid mutant, so it measures nothing');
  }
  return {
    score: Math.floor((detected / valid) * 10000) / 100,
    killed: counts.Killed,
    timeout: counts.Timeout,
    survived: counts.Survived,
    noCoverage: counts.NoCoverage,
  };
}

/**
 * Parses the baseline. Never throws; an unreadable baseline is `{ ok: false }`.
 *
 * @param {string | null} source
 * @returns {{ ok: true, baseline: MutationBaseline } | { ok: false, reason: string }}
 */
export function parseMutationBaseline(source) {
  if (source === null || source.trim() === '') {
    return { ok: false, reason: 'the baseline is missing or empty' };
  }
  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch (failure) {
    return {
      ok: false,
      reason: `the baseline is not valid JSON: ${failure instanceof Error ? failure.message : String(failure)}`,
    };
  }
  const record = /** @type {Record<string, unknown>} */ (parsed);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, reason: 'the baseline is not a JSON object' };
  }
  if (typeof record['target'] !== 'number') {
    return { ok: false, reason: 'the baseline records no numeric `target`' };
  }
  const packages = record['packages'];
  if (typeof packages !== 'object' || packages === null || Object.keys(packages).length === 0) {
    return { ok: false, reason: 'the baseline records no package, so it checks nothing' };
  }
  for (const [name, entry] of Object.entries(packages)) {
    const row = /** @type {Record<string, unknown>} */ (entry);
    const score = row?.['score'];
    // A floor of 0 is a gate that cannot fail; above 100 cannot be met.
    if (typeof score !== 'number' || !(score > 0) || score > 100) {
      return { ok: false, reason: `${name}: score must be a number in (0, 100]` };
    }
    if (typeof row['measuredOn'] !== 'string' || row['measuredOn'] === '') {
      return { ok: false, reason: `${name}: measuredOn is missing` };
    }
  }
  return { ok: true, baseline: /** @type {MutationBaseline} */ (parsed) };
}

/**
 * @param {{ baseline: MutationBaseline, measured: Record<string, number | undefined>,
 *   expectedPackages: readonly string[] }} input
 * @returns {string[]}
 */
export function evaluateMutation({ baseline, measured, expectedPackages }) {
  /** @type {string[]} */
  const failures = [];
  for (const name of expectedPackages) {
    const entry = baseline.packages[name];
    if (entry === undefined) {
      failures.push(
        `${name}: has no entry in mutation-baseline.json. Record it deliberately with ` +
          '`pnpm mutation:ratchet --record`.',
      );
      continue;
    }
    const actual = measured[name];
    if (typeof actual !== 'number') {
      failures.push(`${name}: no mutation report was produced, so nothing was measured`);
    } else if (actual < entry.score) {
      failures.push(`${name}: mutation score ${String(actual)} < ${String(entry.score)}`);
    }
  }
  for (const name of Object.keys(baseline.packages)) {
    if (!expectedPackages.includes(name)) {
      failures.push(`${name}: names a package the mutation run does not cover`);
    }
  }
  return failures;
}

/**
 * Every way a recorded floor can be weakened against the base commit's baseline.
 *
 * @param {MutationBaseline | null} before `null` when there is no base to compare
 * @param {MutationBaseline} after
 * @returns {string[]}
 */
export function loweredMutationFloors(before, after) {
  if (before === null) return [];
  /** @type {string[]} */
  const findings = [];
  if (after.target < before.target) {
    findings.push(`target lowered from ${String(before.target)} to ${String(after.target)}`);
  }
  for (const [name, previous] of Object.entries(before.packages)) {
    const current = after.packages[name];
    if (current === undefined) {
      findings.push(
        `${name}: removed from mutation-baseline.json. A package cannot stop being mutated.`,
      );
    } else if (current.score < previous.score) {
      findings.push(
        `${name}: floor lowered from ${String(previous.score)} to ${String(current.score)}`,
      );
    }
  }
  return findings;
}

/**
 * The baseline after a deliberate `--record`: new packages added, existing floors raised
 * where the measurement is higher, never lowered. Does not mutate its input.
 *
 * @param {MutationBaseline} baseline
 * @param {Record<string, number | undefined>} measured
 * @param {string} date
 * @returns {MutationBaseline}
 */
export function recordScores(baseline, measured, date) {
  /** @type {Record<string, MutationEntry>} */
  const packages = { ...baseline.packages };
  for (const [name, score] of Object.entries(measured)) {
    if (typeof score !== 'number') continue;
    const existing = packages[name];
    if (existing === undefined || score > existing.score) {
      packages[name] = { ...existing, score, measuredOn: date };
    }
  }
  return { ...baseline, packages };
}
