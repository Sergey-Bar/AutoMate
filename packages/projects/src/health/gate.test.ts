import { describe, expect, it } from 'vitest';
import { HEALTH_DIMENSIONS, type HealthGrade } from '@automate/shared-contracts';
import { evaluateHealthGate } from './gate.js';
import { CODEOWNERS_PATHS, ownerOf, parseCodeowners } from './codeowners.js';

function grade(letter: HealthGrade['letter']): HealthGrade {
  return {
    score: letter === null ? null : 85,
    letter,
    incomplete: letter === null,
    incompleteReason: letter === null ? 'Security has not been measured' : null,
    cappedBy: letter === null ? null : 'security',
    cappingValue: null,
    limiter: null,
    dimensions: HEALTH_DIMENSIONS.map((dimension) => ({
      dimension,
      measured: false,
      score: null,
      letter: null,
      weight: 1,
      tools: [],
      openFindings: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
      summary: [],
    })),
    gates: [],
    fixNext: [],
  };
}

describe('evaluateHealthGate', () => {
  it('fails on a failing eval suite and a failing runtime scorecard', () => {
    const verdict = evaluateHealthGate({}, grade('B'), [], null, null, null, {
      evals: [
        { suite: 'support-bot', verdict: 'fail', reasons: ['Pass rate fell from 90% to 30%.'] },
        { suite: 'router', verdict: 'pass', reasons: [] },
      ],
      runtime: { status: 'fail', reasons: ['planner costs $0.40 a run; the budget is $0.10.'] },
    });
    expect(verdict.verdict).toBe('failed');
    expect(verdict.reasons).toEqual([
      'Evals (support-bot): Pass rate fell from 90% to 30%.',
      'Agent runtime: planner costs $0.40 a run; the budget is $0.10.',
    ]);
    for (const agents of [
      { evals: [{ suite: 'a', verdict: 'pass' as const, reasons: [] }], runtime: null },
      { evals: null, runtime: { status: 'pass' as const, reasons: [] } },
      { evals: null, runtime: null },
      null,
      undefined,
    ]) {
      expect(evaluateHealthGate({}, grade('B'), [], null, null, null, agents).verdict).toBe(
        'passed',
      );
    }
  });

  it('fails a gated eval suite that is insufficient, has no baseline, or is missing on the branch', () => {
    const verdict = evaluateHealthGate({}, grade('B'), [], null, null, null, {
      evals: [
        { suite: 'summariser', verdict: 'insufficient', reasons: ['Too few attempts.'] },
        { suite: 'router', verdict: 'no-baseline', reasons: [] },
        { suite: 'planner', verdict: 'missing', reasons: [] },
        { suite: 'quiet', verdict: 'insufficient', reasons: [] },
      ],
      runtime: null,
    });
    expect(verdict.verdict).toBe('failed');
    expect(verdict.reasons).toEqual([
      'Evals (summariser): Too few attempts.',
      'Evals (router): the default branch has no run of this suite to compare against; the policy gates on evals',
      'Evals (planner): the suite runs on the default branch but did not run on this branch; the policy gates on evals',
      'Evals (quiet): too few attempts to tell a regression from noise; the policy gates on evals',
    ]);
  });

  it('fails gated evals with nothing measured, and a gated runtime scorecard that is not measured', () => {
    expect(
      evaluateHealthGate({}, grade('B'), [], null, null, null, { evals: [], runtime: null })
        .reasons,
    ).toEqual([
      'Evals were not measured: no eval run on this branch or the default branch; the policy gates on evals',
    ]);
    for (const status of ['insufficient', 'not_configured'] as const) {
      const verdict = evaluateHealthGate({}, grade('B'), [], null, null, null, {
        evals: null,
        runtime: { status, reasons: [] },
      });
      expect(verdict.verdict).toBe('failed');
      expect(verdict.reasons).toEqual([
        `Agent runtime was not measured (${status === 'insufficient' ? 'too little data' : 'not configured'}); the policy gates on runtime`,
      ]);
    }
    expect(
      evaluateHealthGate({}, grade('B'), [], null, null, null, {
        evals: null,
        runtime: { status: 'insufficient', reasons: ['Only 2 runs in the window.'] },
      }).reasons,
    ).toEqual([
      'Agent runtime was not measured (too little data): Only 2 runs in the window; the policy gates on runtime',
    ]);
  });

  it('fails on a failing AI-governance verdict, with each of its reasons, and only on a fail', () => {
    const failing = {
      verdict: 'fail' as const,
      reasons: [
        'Agent-authored change by claude-code needs at least one human approval; it has none.',
      ],
    };
    const verdict = evaluateHealthGate({}, grade('B'), [], null, null, failing);
    expect(verdict.verdict).toBe('failed');
    expect(verdict.reasons).toEqual([
      'AI governance: Agent-authored change by claude-code needs at least one human approval; it has none.',
    ]);
    for (const aiGovernance of [
      { verdict: 'pass' as const, reasons: [] },
      { verdict: 'not-applicable' as const, reasons: [] },
      null,
      undefined,
    ]) {
      expect(evaluateHealthGate({}, grade('B'), [], null, null, aiGovernance).verdict).toBe(
        'passed',
      );
    }
  });

  it('fails on a failing DORA scorecard when the caller gates on delivery, and only then', () => {
    const failing = {
      status: 'fail' as const,
      reasons: ['Change failure rate is 30%, above the policy maximum of 15%.'],
    };
    const verdict = evaluateHealthGate({}, grade('B'), [], null, failing);
    expect(verdict.verdict).toBe('failed');
    expect(verdict.reasons).toEqual([
      'Delivery: Change failure rate is 30%, above the policy maximum of 15%.',
    ]);
    for (const delivery of [{ status: 'pass' as const, reasons: [] }, null, undefined]) {
      expect(evaluateHealthGate({}, grade('B'), [], null, delivery).verdict).toBe('passed');
    }
  });

  it('fails a gated DORA scorecard that is insufficient or not configured: unmeasured is not a pass', () => {
    expect(
      evaluateHealthGate({}, grade('B'), [], null, { status: 'insufficient', reasons: [] }).reasons,
    ).toEqual(['Delivery was not measured (too little data); the policy gates on delivery']);
    expect(
      evaluateHealthGate({}, grade('B'), [], null, {
        status: 'not_configured',
        reasons: ['No delivery source is connected.'],
      }).reasons,
    ).toEqual([
      'Delivery was not measured (not configured): No delivery source is connected; the policy gates on delivery',
    ]);
  });

  it('fails below minDiffCoverage, passes at it, and fails when diff coverage was not measured', () => {
    const policy = { minDiffCoverage: 80 };
    const below = evaluateHealthGate(policy, grade('B'), [], { ratio: 0.75, executable: 8 });
    expect(below.verdict).toBe('failed');
    expect(below.reasons).toEqual([
      'Diff coverage 75.0% of 8 changed executable lines; the policy requires at least 80%',
    ]);
    expect(evaluateHealthGate(policy, grade('B'), [], { ratio: 0.8, executable: 5 }).verdict).toBe(
      'passed',
    );
    for (const missing of [null, undefined, { ratio: null, executable: 0 }]) {
      const verdict = evaluateHealthGate(policy, grade('B'), [], missing);
      expect(verdict.verdict).toBe('failed');
      expect(verdict.reasons[0]).toMatch(/not measured/u);
    }
    // No minimum: an absent or low diff coverage decides nothing.
    expect(evaluateHealthGate({}, grade('B'), [], { ratio: 0, executable: 3 }).verdict).toBe(
      'passed',
    );
  });
  it('passes with no new findings and no policy', () => {
    expect(evaluateHealthGate(undefined, grade('B'), [])).toEqual({
      verdict: 'passed',
      reasons: [],
      newFindings: { critical: 0, high: 0, total: 0 },
    });
  });

  it('fails on a new critical by default, and not on a new high', () => {
    expect(evaluateHealthGate(undefined, grade('B'), [{ severity: 'high' }]).verdict).toBe(
      'passed',
    );
    const failed = evaluateHealthGate(undefined, grade('B'), [{ severity: 'critical' }]);
    expect(failed).toMatchObject({
      verdict: 'failed',
      reasons: ['1 new critical finding (at most 0 allowed)'],
    });
  });

  it('applies the policy: new highs, a minimum letter, and incomplete against a minimum', () => {
    const policy = { maxNewHigh: 1, minLetter: 'B' as const, maxNewCritical: 2 };
    expect(
      evaluateHealthGate(policy, grade('A'), [{ severity: 'critical' }, { severity: 'high' }])
        .verdict,
    ).toBe('passed');
    expect(
      evaluateHealthGate(policy, grade('A'), [{ severity: 'high' }, { severity: 'high' }]).reasons,
    ).toEqual(['2 new high findings (at most 1 allowed)']);
    expect(evaluateHealthGate(policy, grade('C'), []).reasons).toEqual([
      'Graded C; the policy requires at least B',
    ]);
    expect(evaluateHealthGate(policy, grade(null), []).reasons[0]).toMatch(/incomplete/u);
    expect(evaluateHealthGate({ minLetter: 'A+' }, grade('A+'), []).verdict).toBe('passed');
  });
});

describe('CODEOWNERS', () => {
  const rules = parseCodeowners(
    [
      '# global',
      '*       @org/everyone',
      '*.ts    @org/typescript   # inline comment',
      '/docs/  @org/docs',
      'apps/api/**/routes  @org/api',
      'build/  @org/build',
      '/vendor/',
      'README.md @ana @ben',
    ].join('\n'),
  );

  it.each([
    ['src/index.js', '@org/everyone'],
    ['src/deep/x.ts', '@org/typescript'],
    ['docs/guide/a.ts', '@org/docs'],
    ['other/docs/a.md', '@org/everyone'],
    ['apps/api/src/routes/x.go', '@org/api'],
    ['packages/build/out.js', '@org/build'],
    ['vendor/lib.js', null],
    ['README.md', '@ana @ben'],
    ['./src/x.ts', '@org/typescript'],
  ])('%s is owned by %s, the last matching line', (path, owner) => {
    expect(ownerOf(rules, path)).toBe(owner);
  });

  it('owns nothing without a path or without rules', () => {
    expect(ownerOf(rules, null)).toBeNull();
    expect(ownerOf([], 'a.ts')).toBeNull();
    expect(CODEOWNERS_PATHS[0]).toBe('.github/CODEOWNERS');
  });

  it('keeps a * inside one segment and ? to one character', () => {
    const narrow = parseCodeowners('/src/*.ts @a\n/lib/?.js @b');
    expect(ownerOf(narrow, 'src/x.ts')).toBe('@a');
    expect(ownerOf(narrow, 'src/nested/x.ts')).toBeNull();
    expect(ownerOf(narrow, 'lib/a.js')).toBe('@b');
    expect(ownerOf(narrow, 'lib/ab.js')).toBeNull();
  });

  it('reads **/ as any number of directories, including none, and a bare ** as anything', () => {
    const deep = parseCodeowners('apps/**/routes @api\n/docs/** @docs');
    expect(ownerOf(deep, 'apps/routes/a.ts')).toBe('@api');
    expect(ownerOf(deep, 'apps/x/y/routes/a.ts')).toBe('@api');
    expect(ownerOf(deep, 'apps/xroutes/a.ts')).toBeNull();
    expect(ownerOf(deep, 'docs/a/b.md')).toBe('@docs');
  });

  it('reads at most two thousand rules', () => {
    const many = Array.from({ length: 2500 }, (_, index) => `/f${String(index)}.ts @o`).join('\n');
    expect(parseCodeowners(many)).toHaveLength(2000);
  });
});

describe('gate wording', () => {
  it('counts plurals the way a reader reads them', () => {
    expect(
      evaluateHealthGate(undefined, grade('B'), [
        { severity: 'critical' },
        { severity: 'critical' },
      ]).reasons,
    ).toEqual(['2 new critical findings (at most 0 allowed)']);
    expect(
      evaluateHealthGate({ maxNewHigh: 0 }, grade('B'), [{ severity: 'high' }]).reasons,
    ).toEqual(['1 new high finding (at most 0 allowed)']);
  });
});
