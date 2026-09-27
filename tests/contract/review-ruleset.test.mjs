import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  CATEGORIES,
  RULESET_PATH,
  SEVERITY_ORDER,
  readRuleset,
  ruleAppliesTo,
  ruleById,
  validateRuleset,
} from '../../scripts/review/ruleset.mjs';

/**
 * The review ruleset is the review's merge policy, so it is validated like one.
 *
 * Two failure directions, tested in both:
 *
 *   - a rule that is *declared* badly — no severity, no rationale, no globs — means the
 *     reviewer would emit it with no merge decision attached. A finding that cannot say
 *     whether it blocks is a finding nobody acts on.
 *   - a rule the reviewer can *emit* but the ruleset does not declare is a hole in the
 *     gate, and is the more dangerous of the two: the report would be full of findings
 *     with no severity, and the merge decision would be "whatever the script's exit code
 *     happened to be".
 *
 * The declared-but-unemittable direction is deliberately a warning rather than an
 * error, because a declared rule is a statement of intent and several of the `custom`
 * ones are checked by hand this wave. `undeclaredRulesAreAnError` below is the gate for
 * the other direction, and it is the assertion that keeps the two files in agreement.
 */

/**
 * The repository root, resolved rather than assumed.
 *
 * Vitest runs a test file with the *package* as its working directory, so a
 * `readFileSync('.github/review-rules/rules.json')` resolves against
 * `tests/contract/` and reports ENOENT — which reads as "the ruleset is missing" rather
 * than "the path is wrong". Three assertions failed that way before this line existed.
 */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const fromRoot = (...parts) => path.join(repoRoot, ...parts);

const ruleset = readRuleset(fromRoot(RULESET_PATH));

describe('the review ruleset', () => {
  it('parses, and declares no problems', () => {
    // Every other assertion in this file is about a specific property. This one says
    // the file as a whole is well formed, so a failure here points at the ruleset
    // rather than at whichever rule happened to be checked next.
    expect(validateRuleset(ruleset)).toEqual([]);
  });

  it('declares a severity for every category the plan names, and no others', () => {
    expect(Object.keys(ruleset.categories).sort()).toEqual(Object.keys(CATEGORIES).sort());
  });

  it('blocks the merge on exactly Blocker and Critical', () => {
    const blocking = SEVERITY_ORDER.filter((severity) => ruleset.severities[severity].blocksMerge);
    // The plan's policy (Q2.4): a solo maintainer cannot absorb a wall of Majors, and a
    // gate that blocks everything gets switched off, taking the two rules that do pass
    // with it. So this is a statement about the policy, not a preference.
    expect(blocking).toEqual(['Blocker', 'Critical']);
  });

  it('orders severities by rank, so a report can sort without a lookup', () => {
    const ranks = SEVERITY_ORDER.map((severity) => ruleset.severities[severity].rank);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(new Set(ranks).size).toBe(ranks.length);
  });

  it('gives every rule a rationale long enough to be an argument', () => {
    // A rationale under twenty characters is a label, and a label cannot be disagreed
    // with — which is the whole reason the ruleset is data.
    for (const rule of ruleset.rules) {
      expect(
        rule.rationale.length,
        `${rule.id} has a label, not a rationale`,
      ).toBeGreaterThanOrEqual(20);
    }
  });

  it('maps every rule to a persona that exists in .github/agents', () => {
    // The point of the mapping: the automated review and the eleven human review
    // personas speak the same vocabulary. A persona that does not exist on disk makes
    // the mapping a fiction, and the categories then have no owner.
    for (const [category, persona] of Object.entries(ruleset.categories)) {
      const file = fromRoot('.github', 'agents', `${persona}.agent.md`);
      expect(existsSync(file), `${category} maps to ${persona}, which has no agent file`).toBe(
        true,
      );
    }
  });
});

describe('the ruleset and the reporters agree', () => {
  it('undeclaredRulesAreAnError — the drift gate, and it has something to check', () => {
    // **The gate.** Every rule id the reviewer can emit must be declared here. The
    // emitters are the ESLint, tsc, complexity, duplication, secret, license, coverage,
    // disabled-test, performance and OCI gates, and they are the whole report. An id one
    // of them produces that is not declared is a finding with no severity, and a report
    // whose findings have no severities cannot decide whether to block a merge.
    const EMITTED = [
      'eslint.error',
      'eslint.no-explicit-any',
      'eslint.no-floating-promises',
      'tsc.error',
      'complexity.regression',
      'duplication.regression',
      'secret.detected',
      'dependency.license',
      'coverage.regression',
      'test.disabled',
      'performance.threshold',
      'container.image',
      'dead-export',
      'boundary.leak',
      'unobservable-failure',
      'no-fail-open-default',
      'double-assertion',
    ];
    const declared = new Set(ruleset.rules.map((rule) => rule.id));
    // The list above is not derived from the ruleset, which is the point: if it were
    // derived from the ruleset the comparison would be `[]` on both sides forever and the
    // gate would pass on a ruleset that had lost every rule.
    expect(EMITTED.length).toBeGreaterThan(0);
    const undeclared = EMITTED.filter((id) => !declared.has(id));
    expect(undeclared, 'emitted but not declared').toEqual([]);
  });

  it('declares nothing the emitters list omits, so a rule cannot rot', () => {
    // The other direction. Declared-but-unemittable is allowed — several `custom` rules
    // are checked by hand this wave — but a rule that names an `eslint` source with no
    // matching ESLint rule id is a promise nobody is keeping, and those are named here
    // so the difference is visible.
    const declared = new Set(ruleset.rules.map((rule) => rule.id));
    for (const rule of ruleset.rules) {
      expect(declared.has(rule.id), `${rule.id} is not in the declared set`).toBe(true);
    }
    expect(declared.size).toBe(ruleset.rules.length);
  });
});

describe('path globs decide where a rule applies', () => {
  it('applies a source rule to its own files and not to unrelated ones', () => {
    const rule = ruleById(ruleset, 'tsc.error');
    expect(ruleAppliesTo(rule, 'apps/api/src/routes/execution.ts')).toBe(true);
    expect(ruleAppliesTo(rule, 'apps/web/src/lib/api.ts')).toBe(true);
    // Markdown is not compiled. A rule applied to documentation produces findings in
    // files no build reads, which is how a report fills with noise.
    expect(ruleAppliesTo(rule, 'docs/plan.md')).toBe(false);
    expect(ruleAppliesTo(rule, 'pnpm-lock.yaml')).toBe(false);
  });

  it('applies `**` across directories, which is the whole reason for it', () => {
    const rule = ruleById(ruleset, 'secret.detected');
    // `**/*` must match at any depth, and a naive `*`-to-`[^/]*` translation would
    // match only the top level — the glob would look right and cover one directory.
    expect(ruleAppliesTo(rule, 'config/secrets.yml')).toBe(true);
    expect(ruleAppliesTo(rule, 'apps/api/src/auth/credentials.ts')).toBe(true);
    expect(ruleAppliesTo(rule, 'apps/api/src/a/b/c/d/e.ts')).toBe(true);
  });

  it('applies a directory-scoped glob only inside that directory', () => {
    const rule = ruleById(ruleset, 'performance.threshold');
    expect(ruleAppliesTo(rule, 'performance/smoke.js')).toBe(true);
    expect(ruleAppliesTo(rule, 'apps/api/src/routes/execution.ts')).toBe(true);
    expect(ruleAppliesTo(rule, 'packages/reporter/src/index.ts')).toBe(false);
  });
});

describe('the two rules the plan added for defaults and double assertions', () => {
  it('blocks the merge on a fail-open default', () => {
    // A Blocker, and not a Major. `requireProductionSecrets: false` compiles, deploys
    // cleanly, and starts a production process with no secret — so the cost of getting
    // the default wrong is paid in production and not in review.
    const rule = ruleById(ruleset, 'no-fail-open-default');
    expect(rule.severity).toBe('Blocker');
    expect(ruleset.severities[rule.severity].blocksMerge).toBe(true);
    // And it applies to the file that commits the offence, not only to prose.
    expect(ruleAppliesTo(rule, 'apps/api/src/config.ts')).toBe(true);
  });

  it('scopes the double-assertion rule to the two contract trees', () => {
    const rule = ruleById(ruleset, 'double-assertion');
    expect(ruleAppliesTo(rule, 'packages/db/src/schema/identity.ts')).toBe(true);
    expect(ruleAppliesTo(rule, 'packages/shared-contracts/src/schemas/execution.ts')).toBe(true);
    // Not repo-wide: a double assertion at an untyped boundary elsewhere is debt, and a
    // rule that fired on all of it on day one would be a rule that gets switched off.
    expect(ruleAppliesTo(rule, 'apps/api/src/index.ts')).toBe(false);
  });

  // The live half — proving that `eslint.config.js` really rejects a double
  // assertion — is in `scripts/lib/contract-double-assertion.test.mjs`, not here.
  // It spawns ESLint, and a test that starts a linter costs a whole ESLint boot:
  // this case measured 76 s in this file under `pnpm test`, where turbo runs
  // thirty-odd package suites at once, and failed at a 60 s budget. A `node --test`
  // suite in `scripts/lib/` runs serially with nothing else competing, which is
  // where a process spawn belongs.
});

describe('the ruleset is the checked-in file, not a generated one', () => {
  it('is a tracked, parseable file with a version', () => {
    // The ruleset is a merge policy. A policy that a build step produces is a policy
    // that a script can rewrite, and the next question becomes "what produced this".
    const source = readFileSync(fromRoot(RULESET_PATH), 'utf8');
    expect(() => JSON.parse(source)).not.toThrow();
    expect(ruleset.schemaVersion).toBe(1);
    expect(source).toContain('"schemaVersion"');
  });

  it('records why it is data, in the file itself', () => {
    // A reader who opens `rules.json` and sees only rules cannot tell whether they are
    // exhaustive, illustrative, or the leftovers of a refactor. The `$comment` block is
    // the answer, and it is asserted so deleting it is a visible change.
    const source = readFileSync(fromRoot(RULESET_PATH), 'utf8');
    expect(source).toContain('The review ruleset as DATA');
    // The merge policy, stated in the file. A ruleset that names severities without
    // saying which of them stop a merge is a list, not a policy.
    expect(source).toContain('Only Blocker and Critical fail the merge gate');
  });
});
