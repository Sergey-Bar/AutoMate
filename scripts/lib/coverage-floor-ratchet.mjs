/**
 * The floor ratchet: a coverage floor may go up, never down.
 *
 * `coverage-ratchet.mjs` answers "is the measured coverage still at or above the
 * recorded floor?". It cannot answer "was the recorded floor lowered to make that
 * true?", and that is the more important question — because lowering the floor and
 * lowering the coverage have the same effect on the verdict, and only one of them
 * is a defect.
 *
 * Measured: with `packages/shared-contracts` at 99% statements and its floor edited
 * from `99` to `1`, `pnpm coverage:ratchet` still reported `passed`. The gate was
 * correctly reporting a *true* statement about the wrong number.
 *
 * The only record that survives the pull request is history, so the comparison is
 * against the base commit's `coverage-baseline.json` rather than against a second
 * file in the tree — a second file is editable in the same commit and would be
 * lowered in the same keystroke.
 */
import { execFileSync } from 'node:child_process';

/**
 * Every way a floor can be weakened, as a list of findings.
 *
 * Split per package and per metric because the single-function version of this was 28
 * and the rules are much easier to check against the policy sentence when each is its
 * own function.
 *
 * @param {Record<string, Record<string, unknown>> | null} before
 * @param {Record<string, Record<string, unknown>>} after
 * @returns {string[]}
 */
export function loweredFloors(before, after) {
  // No base to compare against: there is nothing to have lowered, and reporting
  // every floor as lowered on a single-commit clone would be a gate that can never
  // be green. The caller decides whether "no base" is acceptable; this returns
  // nothing, and the caller says so out loud rather than passing quietly.
  if (before === null) return [];
  return Object.entries(before).flatMap(([name, previous]) => {
    const current = after[name];
    if (current === undefined) return [removedFinding(name)];
    if (isUnmeasured(previous) && !isUnmeasured(current)) return [];
    if (!isUnmeasured(previous) && isUnmeasured(current)) return [unmeasuredFinding(name)];
    if (isUnmeasured(previous)) return [];
    return [...loweredMetrics(name, previous, current), ...newMetrics(name, previous, current)];
  });
}

/**
 * @param {Record<string, unknown> | undefined} entry
 * @returns {boolean}
 */
function isUnmeasured(entry) {
  return entry?.status === 'not_configured';
}

/** @param {string} name */
function removedFinding(name) {
  return (
    `${name}: removed from coverage-baseline.json. Deleting a package's floor is a ` +
    'lowering, and a package with tests cannot stop being measured.'
  );
}

/** @param {string} name */
function unmeasuredFinding(name) {
  return (
    `${name}: a measured floor was replaced with {"status":"not_configured"}. That is a ` +
    'removal with a different spelling — nothing now stops the coverage dropping ' +
    'below what it used to be required to reach.'
  );
}

/**
 * Metrics present at the base whose floor is now lower, or no longer a number.
 *
 * @param {string} name
 * @param {Record<string, unknown>} previous
 * @param {Record<string, unknown>} current
 * @returns {string[]}
 */
function loweredMetrics(name, previous, current) {
  /** @type {string[]} */
  const findings = [];
  for (const [metric, floor] of Object.entries(previous)) {
    if (isAnnotation(metric)) continue;
    const now = current[metric];
    if (typeof now !== 'number') {
      findings.push(
        `${name}: the ${metric} floor is no longer a number. A metric that stops being a ` +
          'number stops being a floor.',
      );
      continue;
    }
    if (now < /** @type {number} */ (floor)) {
      findings.push(`${name}: ${metric} floor lowered from ${String(floor)} to ${String(now)}`);
    }
  }
  return findings;
}

/**
 * Metrics with no base floor to compare against.
 *
 * Adding a floor is good. Adding one that no base floor existed for is not comparable,
 * and reporting it is the difference between a visible change and a silent one.
 *
 * @param {string} name
 * @param {Record<string, unknown>} previous
 * @param {Record<string, unknown>} current
 * @returns {string[]}
 */
function newMetrics(name, previous, current) {
  return Object.keys(current)
    .filter((metric) => !isAnnotation(metric) && !(metric in previous))
    .map(
      (metric) =>
        `${name}: the ${metric} floor is new but the metric it guards was previously ` +
        'unmeasured. Adding a floor is good; adding one that is absent from the base is ' +
        'not comparable, so it is reported rather than accepted silently.',
    );
}

/** `status` and `reason` describe a row; they are not metrics. */
/** @param {string} key */
function isAnnotation(key) {
  return key === 'status' || key === 'reason';
}

/**
 * The base commit's baseline, or `null` when there is no base to read.
 *
 * `read` is injected rather than shelling out, so the parsing and the error messages
 * are testable without a repository.
 *
 * @param {{ ref: string | null, read: (ref: string) => string | null }} options
 * @returns {{ baseline: Record<string, Record<string, unknown>> | null, reason: string }}
 */
export function baseBaseline(options) {
  if (options.ref === null) {
    return { baseline: null, reason: 'no base ref was supplied' };
  }
  const source = options.read(options.ref);
  if (source === null) {
    return {
      baseline: null,
      reason: `\`git show ${options.ref}:coverage-baseline.json\` produced nothing, so there is no base to compare against`,
    };
  }
  try {
    const parsed = JSON.parse(source);
    if (typeof parsed !== 'object' || parsed === null) {
      return { baseline: null, reason: `the baseline at ${options.ref} is not a JSON object` };
    }
    return { baseline: parsed, reason: `compared against ${options.ref}` };
  } catch (failure) {
    return {
      baseline: null,
      reason: `the baseline at ${options.ref} is not valid JSON: ${failure instanceof Error ? failure.message : String(failure)}`,
    };
  }
}

/**
 * A default base ref, or `null` when the repository has no history to compare.
 *
 * `COVERAGE_FLOOR_BASE` is what CI sets, explicitly, to the merge base. Locally the
 * parent commit is the honest approximation — a branch that lowered a floor shows the
 * parent still holding the higher one.
 *
 * @param {string} root
 * @returns {{ ref: string | null, source: string }}
 */
export function defaultBaseRef(root) {
  const fromEnv = process.env['COVERAGE_FLOOR_BASE']?.trim();
  if (fromEnv) return { ref: fromEnv, source: 'COVERAGE_FLOOR_BASE' };
  try {
    execFileSync('git', ['rev-parse', '--verify', '--quiet', 'HEAD~1'], {
      cwd: root,
      stdio: 'ignore',
    });
    return { ref: 'HEAD~1', source: 'HEAD~1' };
  } catch {
    return { ref: null, source: 'a single-commit repository' };
  }
}

/**
 * Reads one file out of one commit, or `null`.
 *
 * @param {string} root
 * @param {string} ref
 * @param {string} file
 * @returns {string | null}
 */
export function readFileAtRef(root, ref, file) {
  try {
    return execFileSync('git', ['show', `${ref}:${file}`], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }
}
