import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { semgrepRulesetFindings } from './semgrep-ruleset.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** A minimal well-formed rule, so each test varies one thing. */
const HEALTHY = [
  'rules:',
  '  - id: example-rule',
  '    languages: [typescript]',
  '    severity: ERROR',
  '    message: something is wrong',
  '    patterns:',
  '      - pattern: $A.b($B)',
  '',
].join('\n');

test('a well-formed ruleset has no findings', () => {
  assert.deepEqual(semgrepRulesetFindings(HEALTHY), []);
});

test('an empty ruleset is a finding: it matches nothing', () => {
  const findings = semgrepRulesetFindings('rules: []\n');
  assert.equal(findings.length, 1);
  assert.match(findings[0] ?? '', /empty ruleset matches nothing/);
});

test('a rule reporting a shape it also excludes is a finding', () => {
  // The defect that made `no-raw-sql-interpolation` unable to fire: the exclusion
  // was what saved it, so it looked like coverage of a construct with 45 uses.
  const ruleset = [
    'rules:',
    '  - id: self-cancelling',
    '    languages: [typescript]',
    '    severity: ERROR',
    '    message: raw sql',
    '    patterns:',
    '      - pattern-either:',
    '          - pattern: $DB.raw(`...${...}...`)',
    '          - pattern: sql`...${...}...`',
    '      - pattern-not: sql`...${...}...`',
    '',
  ].join('\n');
  const findings = semgrepRulesetFindings(ruleset);
  assert.equal(findings.length, 1, JSON.stringify(findings));
  assert.match(findings[0] ?? '', /can never fire on it/);
  assert.match(findings[0] ?? '', /sql`/);
});

test('a rule excluding a shape it does not report is fine', () => {
  const ruleset = [
    'rules:',
    '  - id: narrow-exclusion',
    '    languages: [typescript]',
    '    severity: ERROR',
    '    message: raw sql',
    '    patterns:',
    '      - pattern: $DB.raw(`...${...}...`)',
    '      - pattern-not: $DB.raw(`safe`)',
    '',
  ].join('\n');
  assert.deepEqual(semgrepRulesetFindings(ruleset), []);
});

test('`...anything...` in a pattern-not is a finding', () => {
  // A deep wildcard matches the empty sequence too, so it excludes everything and
  // the rule can never fire. This is how `no-comment-only-catch` was inert.
  const ruleset = [
    'rules:',
    '  - id: wildcard-exclusion',
    '    languages: [typescript]',
    '    severity: WARNING',
    '    message: comment only catch',
    '    patterns:',
    '      - pattern: try { ... } catch ($E) { ... }',
    '      - pattern-not: try { ... } catch ($E) { ...anything... }',
    '',
  ].join('\n');
  const findings = semgrepRulesetFindings(ruleset);
  assert.equal(findings.length, 1, JSON.stringify(findings));
  assert.match(findings[0] ?? '', /deep wildcard/);
});

test('`...anything...` in a positive pattern is not a finding', () => {
  // Only an exclusion is a defect. A deep wildcard that *reports* matches broadly,
  // which is noisy but not silent.
  const ruleset = [
    'rules:',
    '  - id: broad-positive',
    '    languages: [typescript]',
    '    severity: WARNING',
    '    message: broad',
    '    pattern: $A(...anything...)',
    '',
  ].join('\n');
  assert.deepEqual(semgrepRulesetFindings(ruleset), []);
});

test('the pre-existing structural defects are still caught', () => {
  const both = [
    'rules:',
    '  - id: malformed',
    '    languages: [typescript]',
    '    severity: ERROR',
    '    message: x',
    '    pattern: $A.b()',
    '    pattern-regex: foo',
    '',
  ].join('\n');
  assert.match(
    semgrepRulesetFindings(both).join('\n'),
    /both pattern and pattern-regex/,
    'a rule declaring both is rejected by semgrep',
  );

  const unsupported = [
    'rules:',
    '  - id: unsupported-operator',
    '    languages: [typescript]',
    '    severity: ERROR',
    '    message: x',
    '    patterns:',
    '      - pattern: $A.b()',
    "        where $X contains 'password'",
    '',
  ].join('\n');
  assert.match(semgrepRulesetFindings(unsupported).join('\n'), /where … contains/);
});

test("the repository's own .semgrep.yml has no findings", () => {
  const source = readFileSync(path.join(root, '.semgrep.yml'), 'utf8');
  assert.deepEqual(semgrepRulesetFindings(source), []);
});
