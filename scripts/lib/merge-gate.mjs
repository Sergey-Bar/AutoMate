/**
 * The merge gate: what a pull request must be before it is allowed in.
 *
 * §17's eleventh point is a sentence — "every pull request gets a real review:
 * `pnpm review --base main` runs a merge gate with zero Blocker/Critical findings,
 * branch naming, a conventional title, a changed-line budget, and a test per behaviour
 * change" — and until now nothing in this repository read it. `review:rules` validates
 * that the *reviewer* can load its vocabulary; it does not look at a branch.
 *
 * **Three outcomes, and the third is not a pass.** The same rule as everywhere else
 * here: `pass`, `fail`, and `not_configured` with a printed reason for why and for which
 * parts did run. A gate whose honest answer on a developer laptop is "I cannot see a
 * diff" has two honest options — say `not_configured` and name the command, or stay
 * silent — and only one of them is a gate. A shallow clone, a detached HEAD and a base
 * that does not exist locally are all real states, and all three are reported rather
 * than passed.
 *
 * **What the gate does not check**, because a gate nobody trusts is one that checks
 * everything: whether the code is *correct*. It checks the shape of the change — name,
 * messages, size, tests, ledger — and `pnpm verify` checks the code. `review:rules` and
 * the emitters carry the reviewer's content rules.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { matchesAny } from '../review/glob.mjs';

/** The three outcomes, in the order severity is reported. */
export const OUTCOMES = ['fail', 'not_configured', 'pass'];

/**
 * @typedef {'pass' | 'fail' | 'not_configured'} Outcome
 */

/**
 * @typedef {object} Check
 * @property {string} id
 * @property {string} what
 * @property {Outcome} outcome
 * @property {string[]} problems
 * @property {string} note why this is not a pass, when it is not
 */

/**
 * @typedef {object} BranchPolicy
 * @property {string} pattern
 * @property {string[]} types
 * @property {string[]} exempt
 */

/**
 * @typedef {object} CommitPolicy
 * @property {string} pattern
 * @property {string[]} types
 * @property {number} maxSubjectLength
 */

/**
 * @typedef {object} BudgetPolicy
 * @property {number} maxChangedLinesPerFile
 * @property {number} maxTotalChangedLines
 * @property {string[]} exemptPaths
 */

/**
 * @typedef {object} TestPolicy
 * @property {string[]} sourceRoots
 * @property {string} marker
 * @property {string} testPathPattern
 * @property {number} minMarkerReasonLength
 */

/**
 * @typedef {object} LedgerPolicy
 * @property {string[]} blockingBands
 * @property {string[]} blockingStatuses
 */

/**
 * @typedef {object} MergePolicy
 * @property {number} schemaVersion
 * @property {BranchPolicy} branch
 * @property {CommitPolicy} commit
 * @property {BudgetPolicy} budget
 * @property {TestPolicy} tests
 * @property {LedgerPolicy} ledger
 */

/** The repository root, from this module's own location. */
export const ROOT = path.resolve(import.meta.dirname, '..', '..');

/** Where the merge gate's policy lives, relative to the root. */
export const POLICY_PATH = '.github/review-rules/merge-gate.json';

/** @returns {MergePolicy} */
export function readPolicy(root = ROOT) {
  const file = path.join(root, POLICY_PATH);
  if (!existsSync(file)) {
    throw new Error(
      `merge-gate policy not found at ${POLICY_PATH}. The budget, the branch grammar and the test ` +
        'requirement are policy, and a policy written into a script is a policy nobody can change ' +
        'without editing the thing that enforces it.',
    );
  }
  return /** @type {MergePolicy} */ (JSON.parse(readFileSync(file, 'utf8')));
}

/**
 * `git` as a function, so the checks below are testable without a repository.
 *
 * A missing or failing `git` returns `null` rather than throwing, because "this host
 * cannot see a diff" is a state to report and not a crash.
 *
 * @param {string[]} args
 * @param {string} [root]
 * @returns {string | null}
 */
export function git(args, root = ROOT) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) return null;
  return result.stdout;
}

/** The current branch, or `null` on a detached HEAD. */
export function currentBranch(root = ROOT) {
  return git(['rev-parse', '--abbrev-ref', 'HEAD'], root)?.trim() ?? null;
}

/**
 * The commits in `base..HEAD`, oldest first.
 *
 * `--no-merges`, because a merge commit's subject is `Merge branch 'x' into y`, which
 * is not a conventional subject and would fail a check about the messages somebody
 * wrote. The commits that carry the change are the ones to read.
 *
 * @param {string} base
 * @param {string} [root]
 * @returns {Array<{ sha: string, subject: string }> | null}
 */
export function commitsSince(base, root = ROOT) {
  const output = git(['log', '--no-merges', '--format=%H%x00%s', `${base}..HEAD`], root);
  if (output === null) return null;
  return output
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => {
      const [sha = '', subject = ''] = line.split('\0');
      return { sha, subject };
    });
}

/**
 * The files that changed, with how many lines each added and removed.
 *
 * `--numstat` rather than `--stat`, because a budget is a count and a count is what
 * has to be compared. A binary file reports `-` for both, which is why the numbers are
 * `Number.parseInt(..., 10) || 0` and a rename of a large asset costs nothing.
 *
 * @param {string} base
 * @param {string} [root]
 * @returns {Array<{ file: string, added: number, removed: number }> | null}
 */
export function changedFiles(base, root = ROOT) {
  const output = git(['diff', '--numstat', `${base}...HEAD`], root);
  if (output === null) return null;
  return output
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => {
      const [added = '', removed = '', file = ''] = line.split('\t');
      return {
        file,
        added: Number.parseInt(added, 10) || 0,
        removed: Number.parseInt(removed, 10) || 0,
      };
    });
}

// ── The five checks ─────────────────────────────────────────────────────────

/**
 * The branch name is `<type>/<description>` with a known type.
 *
 * @param {string | null} branch
 * @param {MergePolicy} policy
 * @returns {Check}
 */
export function checkBranchName(branch, policy) {
  const id = 'branch-name';
  const what = 'the branch is `<type>/<description>` with a declared type';
  if (branch === null) {
    return {
      id,
      what,
      outcome: 'not_configured',
      problems: [],
      note:
        'HEAD is detached, so there is no branch name to check. A merge gate that passes here ' +
        'is a gate that was not run.',
    };
  }
  if (policy.branch.exempt.includes(branch)) {
    return { id, what, outcome: 'pass', problems: [], note: '' };
  }
  const match = new RegExp(policy.branch.pattern).exec(branch);
  if (match === null) {
    return {
      id,
      what,
      outcome: 'fail',
      problems: [
        `\`${branch}\` does not match \`<type>/<description>\`. Expected one of: ` +
          `${policy.branch.types.join(', ')}.`,
      ],
      note: '',
    };
  }
  const type = match.groups?.['type'] ?? '';
  if (!policy.branch.types.includes(type)) {
    return {
      id,
      what,
      outcome: 'fail',
      problems: [
        `\`${branch}\` has the type \`${type}\`, which is not one of ${policy.branch.types.join(', ')}.`,
      ],
      note: '',
    };
  }
  return { id, what, outcome: 'pass', problems: [], note: '' };
}

/**
 * Every commit in the range has a conventional subject.
 *
 * @param {Array<{ sha: string, subject: string }> | null} commits
 * @param {MergePolicy} policy
 * @returns {Check}
 */
export function checkCommitSubjects(commits, policy) {
  const id = 'conventional-subject';
  const what = 'every commit subject is conventional, so the range can be bisected by message';
  if (commits === null) {
    return {
      id,
      what,
      outcome: 'not_configured',
      problems: [],
      note: 'git could not produce a log for the base, so no commit was read.',
    };
  }
  if (commits.length === 0) {
    return {
      id,
      what,
      outcome: 'not_configured',
      problems: [],
      note:
        'the range holds no commits, so there is no message to check. A pull request with no ' +
        'commits is not a pull request this gate can judge.',
    };
  }
  const pattern = new RegExp(policy.commit.pattern);
  const problems = [];
  for (const commit of commits) {
    const match = pattern.exec(commit.subject);
    if (match === null) {
      problems.push(`\`${commit.subject}\` is not \`<type>(<scope>): <subject>\`.`);
      continue;
    }
    const type = match.groups?.['type'] ?? '';
    if (!policy.commit.types.includes(type)) {
      problems.push(
        `\`${commit.subject}\` has the type \`${type}\`, which is not one of ${policy.commit.types.join(', ')}.`,
      );
      continue;
    }
    const summary = match.groups?.['subject'] ?? '';
    if (summary.length > policy.commit.maxSubjectLength) {
      problems.push(
        `\`${summary}\` is ${String(summary.length)} characters; the budget is ${String(policy.commit.maxSubjectLength)}. ` +
          'The part after the colon is what a `git log --oneline` column has to fit.',
      );
    }
  }
  return { id, what, outcome: problems.length === 0 ? 'pass' : 'fail', problems, note: '' };
}

/**
 * No single file and no total exceeds the budget.
 *
 * @param {Array<{ file: string, added: number, removed: number }> | null} files
 * @param {MergePolicy} policy
 * @returns {Check}
 */
export function checkBudget(files, policy) {
  const id = 'changed-line-budget';
  const what = `no file over ${String(policy.budget.maxChangedLinesPerFile)} changed lines, and no range over ${String(policy.budget.maxTotalChangedLines)}`;
  if (files === null) {
    return {
      id,
      what,
      outcome: 'not_configured',
      problems: [],
      note: 'git could not produce a diff for the base, so no size was measured.',
    };
  }
  const exempt = files.filter((entry) => matchesAny(entry.file, policy.budget.exemptPaths));
  const counted = files.filter((entry) => !matchesAny(entry.file, policy.budget.exemptPaths));
  const problems = [];
  for (const entry of counted) {
    const changed = entry.added + entry.removed;
    if (changed > policy.budget.maxChangedLinesPerFile) {
      problems.push(
        `\`${entry.file}\` is ${String(changed)} changed lines, over the per-file budget of ` +
          `${String(policy.budget.maxChangedLinesPerFile)}. A file that large is not reviewed line by ` +
          'line, and a review that did not read it is not a review.',
      );
    }
  }
  const total = counted.reduce((sum, entry) => sum + entry.added + entry.removed, 0);
  if (total > policy.budget.maxTotalChangedLines) {
    problems.push(
      `the range is ${String(total)} changed lines across ${String(counted.length)} file(s), over the ` +
        `total budget of ${String(policy.budget.maxTotalChangedLines)}. Spread evenly is still not read.`,
    );
  }
  const note =
    exempt.length === 0
      ? ''
      : `${String(exempt.length)} generated or lock file(s) excluded from the budget.`;
  return { id, what, outcome: problems.length === 0 ? 'pass' : 'fail', problems, note };
}

/**
 * Every changed source file has a changed test, or carries a marker saying why not.
 *
 * The marker is `review:no-test <reason>` in the file itself, and a reason shorter than
 * the policy's floor is not a reason. A flag in the pull request is not used, because a
 * flag is invisible in the diff a year later and a marker is not.
 *
 * @param {Array<{ file: string, added: number, removed: number }> | null} files
 * @param {MergePolicy} policy
 * @param {(file: string) => string} read a file's contents
 * @returns {Check}
 */
export function checkTestsPerChange(files, policy, read) {
  const id = 'a-test-per-change';
  const what =
    'every changed source file has a changed test beside it, or a `review:no-test` reason';
  if (files === null) {
    return {
      id,
      what,
      outcome: 'not_configured',
      problems: [],
      note: 'git could not produce a diff, so no changed file was examined.',
    };
  }
  const changed = files.map((entry) => entry.file);
  const testPattern = new RegExp(policy.tests.testPathPattern);
  const isSource = (/** @type {string} */ file) =>
    policy.tests.sourceRoots.some((root) => file.startsWith(root)) && !testPattern.test(file);

  const sources = changed.filter(isSource);
  if (sources.length === 0) {
    return { id, what, outcome: 'pass', problems: [], note: 'the change touches no source file.' };
  }
  const changedTests = changed.filter((file) => testPattern.test(file));

  const problems = [];
  for (const file of sources) {
    if (markerReason(read(file), policy) !== null) continue;
    const packageName = packageOf(file);
    const hasTest = changedTests.some((test) => packageOf(test) === packageName);
    if (hasTest) continue;
    problems.push(
      `\`${file}\` changed and no test in \`${packageName}\` changed with it. Add one, or put ` +
        `\`${policy.tests.marker} <reason>\` in the file.`,
    );
  }
  return { id, what, outcome: problems.length === 0 ? 'pass' : 'fail', problems, note: '' };
}

/**
 * The marker and its reason, or `null`.
 *
 * @param {string} source
 * @param {MergePolicy} policy
 * @returns {string | null}
 */
function markerReason(source, policy) {
  const pattern = new RegExp(`${policy.tests.marker}\\s+(.+)`, 'i');
  const match = pattern.exec(source ?? '');
  if (match === null) return null;
  const reason = (match[1] ?? '').trim();
  return reason.length >= policy.tests.minMarkerReasonLength ? reason : null;
}

/**
 * The package a path belongs to, as the part before the source directory.
 *
 * `apps/api/src/routes/health.ts` → `apps/api`. A test for it is a test in the same
 * package, so the comparison is on the two segments rather than on a path prefix — a
 * `packages/ui` test cannot be the test for an `apps/api` source file.
 *
 * @param {string} file
 * @returns {string}
 */
function packageOf(file) {
  const parts = file.replaceAll('\\', '/').split('/');
  return parts.slice(0, 2).join('/');
}

/**
 * No open Blocker or Critical in the ledger.
 *
 * §17's eleventh point names it and this is where it is enforced rather than reported.
 * A `debt` row is excluded on purpose: a deferred finding has an owner and a removal
 * condition, which is the state §1 permits, and `pnpm status:10` is where a deferral is
 * visible.
 *
 * @param {unknown} ledger
 * @param {MergePolicy} policy
 * @returns {Check}
 */
export function checkLedger(ledger, policy) {
  const id = 'zero-blocking-findings';
  const what = 'the ledger carries no open Blocker or Critical';
  const rows = /** @type {{ findings?: unknown }} */ (ledger)?.findings;
  if (!Array.isArray(rows)) {
    return {
      id,
      what,
      outcome: 'not_configured',
      problems: [],
      note:
        'the ledger could not be read, so nothing was checked. A gate that cannot read the ' +
        'ledger must not report it as clean.',
    };
  }
  const blocking = rows.filter(
    (/** @type {{ band?: string, status?: string }} */ row) =>
      policy.ledger.blockingBands.includes(/** @type {string} */ (row.band)) &&
      policy.ledger.blockingStatuses.includes(/** @type {string} */ (row.status)),
  );
  if (blocking.length === 0) {
    return { id, what, outcome: 'pass', problems: [], note: '' };
  }
  return {
    id,
    what,
    outcome: 'fail',
    problems: blocking.map(
      (/** @type {{ id: string, band: string, title: string }} */ row) =>
        `${row.id} (${row.band}): ${row.title}`,
    ),
    note:
      "§17's eleventh point is zero Blocker or Critical. A Blocker cannot be recorded as `debt` — " +
      'it needs a scope decision to clear, not a disposition — so this is the gate noticing a ' +
      'decision nobody has made.',
  };
}

// ── The gate ────────────────────────────────────────────────────────────────

/**
 * Every check, in report order.
 *
 * @param {{ base: string, root?: string }} options
 * @returns {{ checks: Check[], outcome: Outcome }}
 */
export function runMergeGate(options) {
  const root = options.root ?? ROOT;
  const policy = readPolicy(root);
  const commits = commitsSince(options.base, root);
  const files = changedFiles(options.base, root);
  /** @param {string} file */
  const read = (file) => {
    const full = path.join(root, file);
    return existsSync(full) ? readFileSync(full, 'utf8') : '';
  };

  const checks = [
    checkBranchName(currentBranch(root), policy),
    checkCommitSubjects(commits, policy),
    checkBudget(files, policy),
    checkTestsPerChange(files, policy, read),
    checkLedger(readLedger(root), policy),
  ];

  return { checks, outcome: worstOf(checks) };
}

/**
 * @param {string} root
 * @returns {unknown}
 */
function readLedger(root) {
  const file = path.join(root, 'docs', 'quality', 'findings-ledger.json');
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * The worst outcome in a list, by `OUTCOMES` order.
 *
 * @param {Check[]} checks
 * @returns {Outcome}
 */
export function worstOf(checks) {
  for (const outcome of OUTCOMES) {
    if (checks.some((check) => check.outcome === outcome)) {
      return /** @type {Outcome} */ (outcome);
    }
  }
  return 'pass';
}
