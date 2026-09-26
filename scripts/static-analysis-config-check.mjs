/**
 * Structural validation for the static-analysis configs.
 *
 * `.semgrep.yml` and `.gitleaks.toml` were both committed and both inert:
 *
 *  - two semgrep rules were unparseable, so nothing matched;
 *  - a third was self-cancelling — it reported a shape and then excluded the same
 *    shape — and a fourth excluded `...anything...`, a deep wildcard that excludes
 *    every match. Both looked like coverage;
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
 * The semgrep invariants live in `scripts/lib/semgrep-ruleset.mjs` with their own
 * tests, because a check that cannot be exercised against a ruleset known to be
 * broken is a check nobody knows works — and every defect above was invisible
 * precisely for that reason.
 *
 * Plain JavaScript with no dependencies — every script here is `.mjs`.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { semgrepRules, semgrepRulesetFindings } from './lib/semgrep-ruleset.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** @type {string[]} */
const failures = [];

/** @param {string} file @param {string} message */
function fail(file, message) {
  failures.push(`${file}: ${message}`);
}

const semgrepFile = '.semgrep.yml';
const semgrepSource = readFileSync(path.join(root, semgrepFile), 'utf8');

const rulesetFindings = semgrepRulesetFindings(semgrepSource);
for (const finding of rulesetFindings) fail(semgrepFile, finding);
const rules = semgrepRules(semgrepSource);
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
