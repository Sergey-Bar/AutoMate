/**
 * ruleset.mjs — the review ruleset, loaded and validated.
 *
 * `scripts/review/` emits findings; this is what says whether a finding is *allowed*.
 * The two can only be kept in agreement by checking both directions on every run:
 *
 *   - an emitter produced a rule id this file does not declare → **error**. Otherwise a
 *     new lint rule, or a new emitter, silently produces findings that carry no
 *     severity, no rationale, and no merge decision — and a report that cannot say
 *     whether it blocks is a report nobody reads.
 *   - this file declares a rule no emitter can produce → **warning, not error**. A
 *     declared rule is a statement of intent; the emitter for it may not exist yet
 *     (several of the `custom` ones are checked by hand this wave), and refusing to load
 *     would mean deleting the intent instead of implementing it.
 *
 * That asymmetry is deliberate and is the difference between the two directions: the
 * first is a hole in the gate, the second is a promise not yet kept.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { matchesAny } from './glob.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** Where the ruleset lives, relative to the repository root. */
export const RULESET_PATH = '.github/review-rules/rules.json';

/** The severities, ordered most severe first. Order is the policy, not a convention. */
const SEVERITY_ORDER = ['Blocker', 'Critical', 'Major', 'Minor', 'Nit'];

/**
 * The categories the plan names, and the persona each maps to.
 *
 * Declared here as well as in the file because a category without a persona is one
 * nobody owns: the human review and the automated review would then use the same word
 * for different things, which is the opposite of sharing a vocabulary.
 *
 * Typed `Record<string, string>` so a dynamic key is legal — the validation walks keys it
 * has not seen, and the exact key set is what the test pins, not the type. An index
 * signature here is not a loosening: `validateRuleset` reports every key of the *file*
 * that is missing from this object and every key of this object missing from the file, so
 * a category added to either side without the other fails the gate.
 *
 * @type {Record<string, string>}
 */
const CATEGORIES = {
  Bug: 'code-reviewer',
  Vulnerability: 'security-auditor',
  'Security Hotspot': 'security-auditor',
  Reliability: 'backend-engineer',
  Performance: 'performance-engineer',
  Concurrency: 'principal-architect',
  'Error handling': 'backend-engineer',
  Complexity: 'principal-architect',
  Duplication: 'principal-architect',
  Testability: 'qa-test-engineer',
  'Dead code': 'backend-engineer',
  'Boundary design': 'principal-architect',
  Observability: 'devops-engineer',
};

/** Read and parse the ruleset, with a failure that names the file. */
/**
 * @param {string} [rulesetPath]
 * @returns {any}
 */
export function readRuleset(rulesetPath = path.join(repoRoot, RULESET_PATH)) {
  if (!existsSync(rulesetPath)) {
    throw new Error(
      `review ruleset not found at ${RULESET_PATH}. Every rule the reviewer can emit is declared there; without it the reviewer has no severities and no merge policy.`,
    );
  }
  const source = readFileSync(rulesetPath, 'utf8');
  try {
    return JSON.parse(source);
  } catch (failure) {
    // The parse error's own message names a position, which is the useful half.
    const message = failure instanceof Error ? failure.message : String(failure);
    throw new Error(`${RULESET_PATH} is not valid JSON: ${message}`);
  }
}

/**
 * Every declared problem with the ruleset, as a list.
 *
 * A list rather than a throw-per-problem on purpose: a ruleset added in one commit
 * usually has several mistakes in it, and reporting them one run at a time turns fixing
 * them into five round trips.
 */
/**
 * @param {any} ruleset
 * @returns {string[]}
 */
/**
 * A rule is complete when every one of these holds. Each row is a question, and the
 * failure says which one — so a ruleset added in one commit reports all of its problems
 * at once rather than one per run.
 *
 * Declared as data for the same reason the ruleset is: a list of six conditions written
 * as six `if` statements is a list that grows a seventh `if` when a field is added, and
 * the seventh is the one somebody forgets.
 *
 * @type {ReadonlyArray<{ field: string; check: (rule: any) => boolean; problem: (id: string) => string }>}
 */
const RULE_REQUIREMENTS = [
  {
    field: 'severity',
    check: (rule) => SEVERITY_ORDER.includes(rule.severity),
    problem: (id) => `rule ${id} has a severity that is not one of ${SEVERITY_ORDER.join(', ')}`,
  },
  {
    field: 'category',
    check: (rule) => CATEGORIES[rule.category] !== undefined,
    problem: (id) => `rule ${id} has a category that is not one of the plan's thirteen`,
  },
  {
    // Twenty characters, because a shorter "rationale" is a label. A label cannot be
    // disagreed with, and a rule nobody can question is a rule nobody trusts.
    field: 'rationale',
    check: (rule) => typeof rule.rationale === 'string' && rule.rationale.length >= 20,
    problem: () => 'a rule has no rationale — a rule nobody can question is a rule nobody trusts',
  },
  {
    field: 'fix',
    check: (rule) => typeof rule.fix === 'string' && rule.fix.length >= 10,
    problem: (id) => `rule ${id} has no fix guidance`,
  },
  {
    // Without a path glob a rule applies everywhere or nowhere, and both are wrong: a
    // finding about a test file is not a finding about the CSS.
    field: 'pathGlobs',
    check: (rule) => Array.isArray(rule.pathGlobs) && rule.pathGlobs.length > 0,
    problem: (id) => `rule ${id} has no path globs, so it would apply everywhere or nowhere`,
  },
  {
    // A rule that names no source is a promise with nothing behind it.
    field: 'source',
    check: (rule) => typeof rule.source === 'string' && rule.source.length > 0,
    problem: (id) => `rule ${id} names no source, so nothing can be expected to emit it`,
  },
];

/** @param {any} ruleset @returns {string[]} */
function validateSeverities(ruleset) {
  const declared = ruleset.severities ?? {};
  const problems = [];
  for (const severity of SEVERITY_ORDER) {
    const entry = declared[severity];
    if (entry === undefined) problems.push(`severity ${severity} is missing`);
    else if (typeof entry.meaning !== 'string' || entry.meaning.length === 0) {
      problems.push(`severity ${severity} has no meaning`);
    }
  }
  for (const severity of Object.keys(declared)) {
    if (!SEVERITY_ORDER.includes(severity)) {
      problems.push(`severity ${severity} is not one of ${SEVERITY_ORDER.join(', ')}`);
    }
  }
  return problems;
}

/** @param {any} ruleset @returns {string[]} */
function validateCategories(ruleset) {
  const declared = ruleset.categories ?? {};
  const problems = [];
  for (const [category, persona] of Object.entries(declared)) {
    const expected = CATEGORIES[category];
    if (expected === undefined)
      problems.push(`category ${category} is not one of the plan's thirteen`);
    else if (expected !== persona) {
      problems.push(
        `category ${category} maps to ${persona}, but the plan's mapping is ${expected}`,
      );
    }
  }
  for (const category of Object.keys(CATEGORIES)) {
    if (declared[category] === undefined) {
      problems.push(`category ${category} is missing from the ruleset`);
    }
  }
  return problems;
}

/**
 * @param {any} ruleset
 * @returns {string[]}
 */
function validateRules(ruleset) {
  if (!Array.isArray(ruleset.rules) || ruleset.rules.length === 0) {
    return ['the ruleset declares no rules'];
  }
  const problems = [];
  const seen = new Set();
  for (const rule of ruleset.rules) {
    const id = typeof rule?.id === 'string' && rule.id.length > 0 ? rule.id : undefined;
    if (id === undefined) {
      problems.push('a rule has no id');
      continue;
    }
    if (seen.has(id)) problems.push(`rule ${id} is declared twice`);
    seen.add(id);
    for (const requirement of RULE_REQUIREMENTS) {
      if (!requirement.check(rule)) problems.push(requirement.problem(id));
    }
  }
  return problems;
}

/**
 * Every declared problem with the ruleset, as a list.
 *
 * A list rather than a throw-per-problem on purpose: a ruleset added in one commit
 * usually has several mistakes in it, and reporting them one run at a time turns fixing
 * them into five round trips.
 *
 * @param {any} ruleset
 * @returns {string[]}
 */
export function validateRuleset(ruleset) {
  const problems = [];
  if (ruleset.schemaVersion !== 1) {
    problems.push(`schemaVersion must be 1, found ${JSON.stringify(ruleset.schemaVersion)}`);
  }
  problems.push(
    ...validateSeverities(ruleset),
    ...validateCategories(ruleset),
    ...validateRules(ruleset),
  );
  return problems;
}

/** The rule with this id, or `undefined`. */
/**
 * @param {any} ruleset
 * @param {string} id
 * @returns {any}
 */
export function ruleById(ruleset, id) {
  return (ruleset.rules ?? []).find(
    /** @param {{ id?: string } | null | undefined} rule */
    (rule) => rule?.id === id,
  );
}

/**
 * True when a finding at `file` is in scope for a rule's path globs.
 *
 * Delegates to the one glob implementation in the repository. The previous version
 * built its own regex, reserving positions with sentinel characters — a control
 * character in a regular expression, which `no-control-regex` refuses, correctly — and
 * was also a second implementation of "does this glob match this path". A rule that fires
 * in CI and not in review, or the reverse, is what two implementations buy.
 *
 * @param {{ pathGlobs?: readonly string[] }} rule
 * @param {string} file
 * @returns {boolean}
 */
export function ruleAppliesTo(rule, file) {
  return matchesAny(file, rule.pathGlobs ?? []);
}

export { SEVERITY_ORDER, CATEGORIES, repoRoot };
