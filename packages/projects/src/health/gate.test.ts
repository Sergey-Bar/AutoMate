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
