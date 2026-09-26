/**
 * The invariants a semgrep ruleset has to satisfy for its rules to be capable of
 * firing at all.
 *
 * Extracted from `static-analysis-config-check.mjs` so they can be tested. The
 * reasoning behind extracting them is the reason this file exists: a check that
 * cannot be exercised is a check nobody knows works, and the four defects it
 * catches were all invisible precisely because the check that would have caught
 * them was never run against a ruleset known to be broken.
 *
 * Every invariant here is about a rule being *unable to match*, not about a rule
 * being wrong. A rule that matches the wrong thing reports noise; a rule that
 * cannot match reports silence, and silence is indistinguishable from a codebase
 * with no problems.
 *
 * The invariants are grouped by the kind of defect rather than listed in one
 * function, because a single `if` per invariant put `semgrepRulesetFindings` at a
 * cognitive complexity of 26 against a ceiling of 15 — the module that exists to
 * keep a complexity gate honest was itself the thing the gate flagged.
 */

/** @typedef {{ id: string, body: string }} SemgrepRule */

/**
 * Split a ruleset on its top-level `- id:` markers.
 *
 * A real YAML parser would be better, but this repository has no YAML dependency
 * and the invariants concern a rule's keys, which always sit at a known
 * indentation.
 *
 * @param {string} source
 * @returns {SemgrepRule[]}
 */
export function semgrepRules(source) {
  /** @type {Array<{ id: string, lines: string[] }>} */
  const blocks = [];
  const lines = source.split(/\r?\n/);
  /** @type {{ id: string, lines: string[] } | null} */
  let current = null;
  for (const line of lines) {
    if (/^ {2}- id:/.test(line)) {
      if (current) blocks.push(current);
      current = { id: line.replace(/^ {2}- id:\s*/, '').trim(), lines: [line] };
      continue;
    }
    if (current) current.lines.push(line);
  }
  if (current) blocks.push(current);
  return blocks.map((block) => ({ id: block.id, body: block.lines.join('\n') }));
}

/**
 * The lines of a rule body, and the indentation of each.
 *
 * @param {string} body
 * @returns {Array<{ line: string, indent: number }>}
 */
function bodyLines(body) {
  return body.split(/\r?\n/).map((line) => ({
    line,
    indent: line.length - line.trimStart().length,
  }));
}

/** The value written for an operator key, inline or as the first line of its block. */
/** @param {string} key @returns {RegExp} */
const INLINE_VALUE = (key) => new RegExp(`^\\s*-?\\s*${key}:\\s+(\\S.*)$`);
/** Whether a line is an operator key with its value in a block beneath it. */
/** @param {string} key @returns {RegExp} */
const BLOCK_VALUE = (key) => new RegExp(`^\\s*-?\\s*${key}:\\s*$`);
/** The operator key a block member repeats, with its leading `- `. */
const MEMBER_PREFIX = /^\s*-\s*(?:pattern|pattern-either|pattern-not|pattern-not-inside)\s*:\s*/;

/**
 * Every value an operator introduces, in both spellings YAML allows for it: on the
 * same line as the key, or in an indented block beneath it.
 *
 * Both spellings occur in real rulesets, and reading only one of them is how a
 * self-cancelling rule slipped past the first version of this check — the exclusion
 * that cancelled the rule was written inline while the rule's members were a block.
 * One scan serves both, which also keeps the two shapes from drifting apart again.
 *
 * @param {string} body
 * @param {string} key a regex alternation naming the operator, e.g. `(?:pattern|pattern-either)`
 * @returns {string[]}
 */
function valuesFor(body, key) {
  /** @type {string[]} */
  const found = [];
  const entries = bodyLines(body);
  const inline = INLINE_VALUE(key);
  const block = BLOCK_VALUE(key);

  for (const [index, entry] of entries.entries()) {
    const onSameLine = inline.exec(entry.line);
    if (onSameLine !== null) {
      found.push((onSameLine[1] ?? '').trim());
      continue;
    }
    if (!block.test(entry.line)) continue;
    for (const member of entries.slice(index + 1)) {
      if (member.line.trim() === '') continue;
      if (member.indent <= entry.indent) break;
      found.push(member.line.replace(MEMBER_PREFIX, '').trim());
    }
  }
  return found.filter((value) => value !== '');
}

/**
 * The shapes a rule reports, from `pattern` and `pattern-either`.
 *
 * Compared as source text, not normalised. Stripping the backticks makes
 * `$DB.raw(\`X\`)` and `sql\`X\`` indistinguishable, so an earlier version matched
 * the wrong shape and named it in the finding. Comparing the text is imprecise in
 * the safe direction — a false negative rather than a misleading message.
 *
 * @param {string} body
 * @returns {Set<string>}
 */
function shapeStrings(body) {
  return new Set(valuesFor(body, '(?:pattern|pattern-either)'));
}

/**
 * The shapes a rule excludes, from every `pattern-not` and `pattern-not-inside`.
 *
 * @param {string} body
 * @returns {string[]}
 */
function exclusions(body) {
  return valuesFor(body, 'pattern-not(?:-inside)?');
}

/**
 * A rule that is missing something semgrep needs, or declares a combination
 * semgrep rejects.
 *
 * @param {SemgrepRule} rule
 * @returns {string[]}
 */
function shapeFindings(rule) {
  const findings = [];
  const { id, body } = rule;
  if (!/\n\s+message:/.test(body)) findings.push(`rule "${id}" has no message`);
  if (!/\n\s+severity:\s*(ERROR|WARNING|INFO)/.test(body))
    findings.push(`rule "${id}" has no severity of ERROR, WARNING or INFO`);
  if (!/\n\s+languages:/.test(body)) findings.push(`rule "${id}" declares no languages`);
  if (!/patterns:|pattern:|pattern-either:|pattern-regex:|pattern-inside:/.test(body))
    findings.push(`rule "${id}" has no pattern operator`);

  // Semgrep rejects a rule that declares `pattern` and `pattern-regex` at the rule
  // level, so it never matches anything.
  if (/^\s+pattern:\s/m.test(body) && /^\s+pattern-regex:\s/m.test(body))
    findings.push(
      `rule "${id}" declares both pattern and pattern-regex at the rule level; semgrep ` +
        'rejects that combination, so the rule never matches anything',
    );
  return findings;
}

/**
 * A rule using an operator semgrep does not have, or a wildcard that excludes
 * everything.
 *
 * `contains` is not a semgrep operator; the set operators are `<<` and `>>`.
 * `...anything...` is a deep wildcard: it matches any sequence, including the empty
 * one, so in a `pattern-not` it excludes every match and the rule cannot fire.
 *
 * @param {SemgrepRule} rule
 * @returns {string[]}
 */
function operatorFindings(rule) {
  const findings = [];
  if (/\bwhere\b[\s\S]*?\bcontains\b/.test(rule.body))
    findings.push(
      `rule "${rule.id}" uses a \`where … contains …\` clause, which semgrep does ` +
        'not support, so the clause never matches',
    );
  for (const match of rule.body.matchAll(/pattern-not(-inside)?:[^\n]*\.\.\.anything\.\.\./g)) {
    findings.push(
      `rule "${rule.id}" uses \`...anything...\` in a ${match[1] ?? 'pattern-not'}, which ` +
        'is a deep wildcard matching every sequence including the empty one. It ' +
        'therefore excludes every match and the rule cannot fire. Name the specific ' +
        'expression to exclude instead.',
    );
  }
  return findings;
}

/**
 * A rule that reports a shape and then excludes it.
 *
 * `no-raw-sql-interpolation` listed `sql`...${...}...`` among the shapes it reports
 * and excluded the identical shape with `pattern-not`. Semgrep intersects the
 * operators, so the rule could not fire on the one case it named. The exclusion is
 * what made it harmless, which is the dangerous part: the rule looked like it
 * covered a construct with 45 uses in this tree.
 *
 * @param {SemgrepRule} rule
 * @returns {string[]}
 */
function selfCancellationFindings(rule) {
  const reported = shapeStrings(rule.body);
  const findings = [];
  for (const excluded of exclusions(rule.body)) {
    if (!reported.has(excluded)) continue;
    findings.push(
      `rule "${rule.id}" reports the shape \`${excluded}\` and then excludes the same ` +
        'shape, so it can never fire on it. Either drop the inclusion or narrow the ' +
        'exclusion to the part that is genuinely safe.',
    );
  }
  return findings;
}

/**
 * Everything wrong with a ruleset, as human-readable findings.
 *
 * @param {string} source the contents of `.semgrep.yml`
 * @returns {string[]}
 */
export function semgrepRulesetFindings(source) {
  const rules = semgrepRules(source);
  /** @type {string[]} */
  const findings = [];

  if (rules.length === 0) findings.push('no rules found; an empty ruleset matches nothing');

  /** @type {Set<string>} */
  const seenIds = new Set();
  for (const rule of rules) {
    if (rule.id === '') findings.push('a rule has an empty id');
    if (seenIds.has(rule.id)) findings.push(`duplicate rule id "${rule.id}"`);
    seenIds.add(rule.id);
    findings.push(
      ...shapeFindings(rule),
      ...operatorFindings(rule),
      ...selfCancellationFindings(rule),
    );
  }

  return findings;
}
