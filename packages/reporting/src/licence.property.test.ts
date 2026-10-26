import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  evaluateLicence,
  formatLicenceExpression,
  parseLicenceExpression,
  type LicenceExpression,
  type LicencePolicy,
} from './licence.js';

/**
 * Property suite for LICENCE-1, LICENCE-2 and LICENCE-3.
 *
 * Fixed seed and `numRuns`, so a red run reproduces on any host. Expressions are drawn
 * from a small id pool on purpose: a pool of five makes the same licence appear on both
 * sides of an AND or OR often, which is where an evaluator goes wrong.
 */
const SEED = 20261102;
const params = { seed: SEED, numRuns: 400 } as const;

const IDS = ['MIT', 'Apache-2.0', 'GPL-3.0', 'BSD-3-Clause', 'LicenseRef-acme'] as const;

const leaf: fc.Arbitrary<LicenceExpression> = fc
  .record({
    id: fc.constantFrom(...IDS),
    orLater: fc.boolean(),
    exception: fc.option(fc.constantFrom('Classpath-exception-2.0', 'LLVM-exception'), {
      nil: null,
    }),
  })
  .map(({ id, orLater, exception }) => ({
    kind: 'licence' as const,
    id,
    // A reference carries no version, so it cannot be "or later".
    orLater: orLater && !id.startsWith('LicenseRef-'),
    exception,
  }));

const { expression } = fc.letrec<{ expression: LicenceExpression }>((tie) => ({
  expression: fc.oneof(
    { depthSize: 'small', withCrossShrink: true },
    leaf,
    fc.record({
      kind: fc.constantFrom('and' as const, 'or' as const),
      left: tie('expression'),
      right: tie('expression'),
    }),
  ),
}));

const policy: fc.Arbitrary<LicencePolicy> = fc.record(
  {
    allow: fc.subarray([...IDS, 'GPL-3.0 WITH Classpath-exception-2.0']),
    deny: fc.subarray([...IDS, 'BSD-3-Clause WITH LLVM-exception']),
  },
  { requiredKeys: [] },
);

/** LICENCE-1, as a predicate, so the harness check below can run it against a wrong claim. */
function addingAnAllowedBranchNeverDenies(text: string, rules: LicencePolicy): boolean {
  const extra = 'ISC';
  const widened = { ...rules, allow: [...(rules.allow ?? []), extra] };
  const before = evaluateLicence(text, widened).verdict;
  const after = evaluateLicence(`(${text}) OR ${extra}`, widened).verdict;
  return !(before === 'allowed' && after === 'denied') && after === 'allowed';
}

describe('LICENCE-1: adding an OR branch the policy allows never turns allowed into denied', () => {
  it('holds, and the widened expression is always allowed', () => {
    fc.assert(
      fc.property(expression, policy, (tree, rules) =>
        addingAnAllowedBranchNeverDenies(formatLicenceExpression(tree), rules),
      ),
      {
        ...params,
        examples: [[{ kind: 'licence', id: 'GPL-3.0', orLater: false, exception: null }, {}]],
      },
    );
  });
});

describe('LICENCE-2: A AND B is denied whenever A alone is denied', () => {
  it('holds on either side of the AND', () => {
    fc.assert(
      fc.property(expression, expression, policy, (a, b, rules) => {
        const left = formatLicenceExpression(a);
        const right = formatLicenceExpression(b);
        fc.pre(evaluateLicence(left, rules).verdict === 'denied');
        expect(evaluateLicence(`(${left}) AND (${right})`, rules).verdict).toBe('denied');
        expect(evaluateLicence(`(${right}) AND (${left})`, rules).verdict).toBe('denied');
      }),
      {
        ...params,
        examples: [
          [
            { kind: 'licence', id: 'GPL-3.0', orLater: true, exception: null },
            { kind: 'licence', id: 'MIT', orLater: false, exception: null },
            { deny: ['GPL-3.0'] },
          ],
        ],
      },
    );
  });
});

describe('LICENCE-3: formatting and reading back is the identity', () => {
  it('reads every formatted expression back to the same tree', () => {
    fc.assert(
      fc.property(expression, (tree) => {
        const read = parseLicenceExpression(formatLicenceExpression(tree));
        expect(read).toEqual({ status: 'parsed', expression: tree });
      }),
      params,
    );
  });
});

describe('the property harness can fail', () => {
  it('refutes the wrong claim that A AND B is allowed whenever A is', () => {
    const wrong = fc.check(
      fc.property(expression, expression, policy, (a, b, rules) => {
        const left = formatLicenceExpression(a);
        if (evaluateLicence(left, rules).verdict !== 'allowed') return true;
        const both = `(${left}) AND (${formatLicenceExpression(b)})`;
        return evaluateLicence(both, rules).verdict === 'allowed';
      }),
      params,
    );
    expect(wrong.failed).toBe(true);
  });

  it('refutes LICENCE-1 for an evaluator that lets one denied branch deny an OR', () => {
    // A substring-style gate: any denied id anywhere in the text denies the package.
    const naive = (text: string, rules: LicencePolicy) =>
      (rules.deny ?? []).some((id) => text.includes(id)) ? 'denied' : 'allowed';
    const result = fc.check(
      fc.property(expression, policy, (tree, rules) => {
        const text = formatLicenceExpression(tree);
        return naive(`(${text}) OR ISC`, rules) !== 'denied';
      }),
      params,
    );
    expect(result.failed).toBe(true);
  });
});
