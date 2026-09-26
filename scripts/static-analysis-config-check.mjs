/**
 * Structural validation for the static-analysis configs.
 *
 * `.semgrep.yml` and `.gitleaks.toml` were both committed and both inert:
 *
 *  - two semgrep rules were unparseable, so nothing matched;
 *  - `.gitleaks.toml` allowlisted `[A-Za-z0-9+/]{40,}` in every `*.test.ts`,
 *    which is a blanket exemption for the exact values the scanner exists to
 *    find.
 *
 * Neither tool is installed in every environment, so this script cannot replace
 * them. It checks what is checkable without them: that each config is
 * structurally sound, and that no allowlist entry is broad enough to disable the
 * scanner it belongs to. `security:verify` runs the real scanners when present
 * and always runs this.
 *
 * Plain JavaScript with no dependencies — every script here is `.mjs`.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** @type {string[]} */
const failures = [];

/** @param {string} file @param {string} message */
function fail(file, message) {
  failures.push(`${file}: ${message}`);
}

const semgrepFile = '.semgrep.yml';
const semgrepSource = readFileSync(path.join(root, semgrepFile), 'utf8');

/**
 * Split the rule list on top-level `- id:` markers.
 *
 * A real YAML parser would be better, but this repository has no YAML
 * dependency and the invariants below concern a rule's keys, which always sit at
 * a known indentation.
 */
/** @param {string} source @returns {Array<{id: string, body: string}>} */
function semgrepRules(source) {
  const blocks = [];
  const lines = source.split(/\r?\n/);
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

const rules = semgrepRules(semgrepSource);
if (rules.length === 0) fail(semgrepFile, 'no rules found; an empty ruleset matches nothing');

const seenIds = new Set();
for (const rule of rules) {
  if (rule.id === '') fail(semgrepFile, 'a rule has an empty id');
  if (seenIds.has(rule.id)) fail(semgrepFile, `duplicate rule id "${rule.id}"`);
  seenIds.add(rule.id);

  if (!/\n\s+message:/.test(rule.body)) fail(semgrepFile, `rule "${rule.id}" has no message`);
  if (!/\n\s+severity:\s*(ERROR|WARNING|INFO)/.test(rule.body))
    fail(semgrepFile, `rule "${rule.id}" has no severity of ERROR, WARNING or INFO`);
  if (!/\n\s+languages:/.test(rule.body))
    fail(semgrepFile, `rule "${rule.id}" declares no languages`);

  // The defect that made two rules inert: a rule may declare `pattern` or
  // `pattern-regex`, never both, because semgrep rejects the combination.
  const topLevelPattern = /^\s+pattern:\s/m.test(rule.body);
  const topLevelPatternRegex = /^\s+pattern-regex:\s/m.test(rule.body);
  if (topLevelPattern && topLevelPatternRegex)
    fail(
      semgrepFile,
      `rule "${rule.id}" declares both pattern and pattern-regex at the rule level; ` +
        'semgrep rejects that combination, so the rule never matches anything',
    );
  if (!/patterns:|pattern:|pattern-either:|pattern-regex:|pattern-inside:/.test(rule.body))
    fail(semgrepFile, `rule "${rule.id}" has no pattern operator`);

  // `where $X contains 'y'` was the other inert spelling. `contains` is not a
  // semgrep operator; the set operators are `<<` and `>>`.
  if (/\bwhere\b[\s\S]*?\bcontains\b/.test(rule.body))
    fail(
      semgrepFile,
      `rule "${rule.id}" uses a \`where … contains …\` clause, which semgrep does ` +
        'not support, so the clause never matches',
    );
}

const gitleaksFile = '.gitleaks.toml';
const gitleaksSource = readFileSync(path.join(root, gitleaksFile), 'utf8');

/** Every `'''…'''` literal from the allowlist section onwards. */
/** @param {string} source @returns {string[]} */
function allowlistLiterals(source) {
  const start = source.indexOf('[allowlist');
  if (start === -1) return [];
  return [...source.slice(start).matchAll(/'''([^']*)'''/g)].map((match) => match[1]);
}

/**
 * A bare character class with a large quantifier matches a large fraction of
 * ordinary content, which is an allowlist entry in disguise. The original
 * `[A-Za-z0-9+/]{40,}={0,2}` is the canonical example: it matches every hash,
 * token and long base64 string, in every test file.
 */
/** @param {string} literal */
function isOverBroadAllowlist(literal) {
  if (literal.length < 12) return false;
  return /^\[.+\]\{\d+,\d*\}.*$/.test(literal);
}

for (const literal of allowlistLiterals(gitleaksSource)) {
  if (isOverBroadAllowlist(literal))
    fail(
      gitleaksFile,
      `allowlist entry ${literal} matches a broad class of values, which disables ` +
        'detection rather than exempting a known-safe fixture',
    );
}

if (/^\s*regex\s*=\s*'''\[A-Za-z0-9/gm.test(gitleaksSource))
  fail(
    gitleaksFile,
    'a rule uses a bare high-entropy character class, which matches every hash, ' +
      'token and long string rather than one specific fixture',
  );

// An allowlist that ignores whole source trees disables the scanner where a
// leaked fixture is most likely to be committed.
for (const literal of allowlistLiterals(gitleaksSource)) {
  if (/(?:\*\*?|\.\*\/)/.test(literal) && /\.(?:test|spec)\./.test(literal))
    fail(
      gitleaksFile,
      `allowlist entry ${literal} ignores every test or spec file, which is where a ` +
        'leaked fixture is most likely to live',
    );
}

if (!/useDefault\s*=\s*true/.test(gitleaksSource))
  fail(gitleaksFile, 'the default ruleset is not enabled, so provider token rules are absent');

if (failures.length > 0) {
  console.error('Static-analysis config check failed');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(
  `Static-analysis config check passed: ${rules.length} semgrep rule(s) are structurally ` +
    'sound and the gitleaks allowlist exempts nothing broad.',
);
