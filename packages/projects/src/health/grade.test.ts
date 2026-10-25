import { describe, expect, it } from 'vitest';
import { HealthGradeSchema, type DimensionMetric } from '@automate/shared-contracts';
import { mergeConfig } from '../config.js';
import {
  GATE_CEILING,
  findingsScore,
  grade,
  letterFor,
  type FindingObservation,
  type FindingToolRun,
  type HealthInputs,
} from './grade.js';

const SEMGREP: FindingToolRun = {
  tool: { name: 'semgrep', version: '1.90.0' },
  dimensions: ['security'],
};
const GITLEAKS: FindingToolRun = {
  tool: { name: 'gitleaks', version: '8.21.0' },
  dimensions: ['security'],
};
const OSV: FindingToolRun = {
  tool: { name: 'osv-scanner', version: '1.9.0' },
  dimensions: ['dependencies'],
};
const ESLINT: FindingToolRun = {
  tool: { name: 'eslint', version: '9.0.0' },
  dimensions: ['code-quality'],
};

function finding(overrides: Partial<FindingObservation> = {}): FindingObservation {
  return {
    fingerprint: `fp-${Math.random().toString(36).slice(2)}`,
    tool: 'semgrep',
    ruleId: 'javascript.lang.security.eval',
    kind: 'issue',
    severity: 'medium',
    dimension: 'security',
    path: 'src/index.ts',
    line: 3,
    message: 'eval of user input',
    helpUri: 'https://semgrep.dev/r/eval',
    fixAvailable: null,
    state: 'open',
    ...overrides,
  };
}

function metric(overrides: Partial<DimensionMetric>): DimensionMetric {
  return {
    dimension: 'coverage',
    metric: 'line coverage',
    tool: { name: 'istanbul', version: null },
    score: 85,
    summary: '85.0% of lines covered',
    ...overrides,
  };
}

function inputs(overrides: Partial<HealthInputs> = {}): HealthInputs {
  return {
    findingTools: [SEMGREP, GITLEAKS, OSV, ESLINT],
    findings: [],
    metrics: [],
    failingTests: null,
    ...overrides,
  };
}

describe('letterFor', () => {
  it.each([
    [100, 'A+'],
    [97, 'A+'],
    [96.9, 'A'],
    [90, 'A'],
    [89.9, 'B'],
    [80, 'B'],
    [79.9, 'C'],
    [70, 'C'],
    [69.9, 'D'],
    [60, 'D'],
    [59.9, 'F'],
    [0, 'F'],
  ])('%d is %s', (score, letter) => {
    expect(letterFor(score)).toBe(letter);
  });
});

describe('findingsScore', () => {
  it('is 100 with no open findings, and ignores triaged ones', () => {
    expect(findingsScore([])).toBe(100);
    expect(findingsScore([finding({ state: 'accepted', severity: 'critical' })])).toBe(100);
    expect(findingsScore([finding({ state: 'false_positive' })])).toBe(100);
  });

  it('puts one critical in F, one high in C and one medium in A', () => {
    expect(letterFor(findingsScore([finding({ severity: 'critical' })]))).toBe('F');
    expect(letterFor(findingsScore([finding({ severity: 'high' })]))).toBe('C');
    expect(letterFor(findingsScore([finding({ severity: 'medium' })]))).toBe('A');
    expect(findingsScore([finding({ severity: 'info' })])).toBe(100);
  });
});

describe('grade', () => {
  it('gives a clean, measured repository an A+ and names its limiter', () => {
    const result = grade(inputs());
    expect(HealthGradeSchema.parse(result)).toEqual(result);
    expect(result.letter).toBe('A+');
    expect(result.score).toBe(100);
    expect(result.incomplete).toBe(false);
    expect(result.cappedBy).not.toBeNull();
    expect(result.fixNext).toEqual([]);
  });

  it('never measures a dimension no tool reported on', () => {
    const result = grade(inputs());
    const coverage = result.dimensions.find((entry) => entry.dimension === 'coverage');
    expect(coverage).toMatchObject({ measured: false, score: null, letter: null, tools: [] });
    const security = result.dimensions.find((entry) => entry.dimension === 'security');
    expect(security?.tools.map((tool) => tool.name)).toEqual(['gitleaks', 'semgrep']);
    expect(security?.summary).toEqual(['No open findings from semgrep, gitleaks']);
  });

  it('is incomplete without Security, whatever else is measured', () => {
    const result = grade(inputs({ findingTools: [OSV, ESLINT], metrics: [metric({})] }));
    expect(result).toMatchObject({
      incomplete: true,
      score: null,
      letter: null,
      cappedBy: null,
      limiter: null,
    });
    expect(result.incompleteReason).toMatch(/Security/u);
  });

  it('is incomplete with Security alone', () => {
    const result = grade(inputs({ findingTools: [SEMGREP] }));
    expect(result.incomplete).toBe(true);
    expect(result.incompleteReason).toMatch(/two dimensions/u);
  });

  it('caps the grade at D for an open secret, and says so', () => {
    const secret = finding({
      tool: 'gitleaks',
      ruleId: 'aws-access-token',
      kind: 'secret',
      severity: 'low',
    });
    const result = grade(inputs({ findings: [secret] }));
    expect(result.score).toBe(GATE_CEILING);
    expect(result.letter).toBe('D');
    expect(result.cappedBy).toBe('open-secret');
    expect(result.limiter).toBe('Capped at D — 1 open secret in the repository');
    expect(result.gates.find((gate) => gate.id === 'open-secret')).toMatchObject({
      tripped: true,
      enabled: true,
    });
    expect(result.fixNext[0]).toMatchObject({ key: 'gate:open-secret', findings: 1 });
    expect(result.fixNext[0]?.gain).toBeGreaterThan(30);
  });

  it('caps for a critical vulnerability only when a fix is available', () => {
    const unfixable = finding({
      kind: 'vulnerability',
      severity: 'critical',
      dimension: 'dependencies',
      tool: 'osv-scanner',
    });
    expect(
      grade(inputs({ findings: [unfixable] })).gates.find(
        (gate) => gate.id === 'fixable-critical-vulnerability',
      )?.tripped,
    ).toBe(false);
    const fixable = { ...unfixable, fixAvailable: true };
    const result = grade(inputs({ findings: [fixable] }));
    expect(result.gates.find((gate) => gate.id === 'fixable-critical-vulnerability')?.tripped).toBe(
      true,
    );
    expect(result.score).toBeLessThanOrEqual(GATE_CEILING);
  });

  it('caps for failing tests on the default branch', () => {
    const result = grade(
      inputs({
        failingTests: 3,
        metrics: [
          metric({ dimension: 'tests', metric: 'qa score', score: 95, summary: 'QA score 95' }),
        ],
      }),
    );
    expect(result.cappedBy).toBe('failing-tests');
    expect(result.limiter).toBe('Capped at D — 3 failing tests on the default branch');
    expect(result.fixNext[0]?.key).toBe('gate:failing-tests');
  });

  it('reports a tripped gate but names the dimension when the score is already below the cap', () => {
    const many = Array.from({ length: 4 }, () => finding({ severity: 'critical' }));
    const secret = finding({
      kind: 'secret',
      tool: 'gitleaks',
      ruleId: 'generic-api-key',
      severity: 'high',
    });
    const result = grade(inputs({ findings: [...many, secret] }));
    expect(result.score).toBeLessThan(GATE_CEILING);
    expect(result.cappedBy).toBe('security');
    expect(result.limiter).toMatch(/^Limited by Security — 4 critical, 1 high open/u);
  });

  it('honours a disabled gate, and still shows it', () => {
    const secret = finding({
      kind: 'secret',
      tool: 'gitleaks',
      ruleId: 'generic-api-key',
      severity: 'low',
    });
    const result = grade(
      inputs({ findings: [secret], policy: { disabledGates: ['open-secret'] } }),
    );
    expect(result.score).toBeGreaterThan(GATE_CEILING);
    expect(result.gates.find((gate) => gate.id === 'open-secret')).toMatchObject({
      tripped: true,
      enabled: false,
    });
  });

  it('a weight of zero drops a measured dimension from the overall score', () => {
    const findings = [
      finding({
        dimension: 'code-quality',
        tool: 'eslint',
        ruleId: 'no-unused-vars',
        severity: 'high',
      }),
    ];
    const weighted = grade(inputs({ findings }));
    const dropped = grade(inputs({ findings, policy: { weights: { 'code-quality': 0 } } }));
    expect(weighted.score).toBeLessThan(100);
    expect(dropped.score).toBe(100);
    expect(dropped.dimensions.find((entry) => entry.dimension === 'code-quality')).toMatchObject({
      measured: true,
      weight: 0,
    });
  });

  it('combines findings and metrics in one dimension as a geometric mean', () => {
    const duplication = metric({
      dimension: 'code-quality',
      metric: 'duplication',
      tool: { name: 'jscpd', version: '4.0.5' },
      score: 64,
      summary: '9.0% of lines duplicated',
    });
    const result = grade(inputs({ metrics: [duplication] }));
    const quality = result.dimensions.find((entry) => entry.dimension === 'code-quality');
    expect(quality?.score).toBe(80);
    expect(quality?.summary).toEqual(['No open findings from eslint', '9.0% of lines duplicated']);
    expect(result.fixNext.map((item) => item.key)).toEqual(['metric:code-quality:duplication']);
  });

  it('ranks fix-next by the gain the grade function itself computes', () => {
    const findings = [
      finding({ ruleId: 'sql-injection', severity: 'high' }),
      finding({ ruleId: 'sql-injection', severity: 'high', path: 'src/b.ts' }),
      finding({ ruleId: 'weak-hash', severity: 'low' }),
      finding({
        dimension: 'code-quality',
        tool: 'eslint',
        ruleId: 'no-console',
        severity: 'info',
      }),
    ];
    const result = grade(inputs({ findings }));
    expect(result.fixNext.map((item) => item.key)).toEqual([
      'rule:security:semgrep:sql-injection',
      'rule:security:semgrep:weak-hash',
    ]);
    expect(result.fixNext[0]).toMatchObject({
      findings: 2,
      title: 'semgrep: sql-injection (2 places)',
    });
    expect(result.fixNext[0]?.gain).toBeGreaterThan(result.fixNext[1]?.gain ?? 0);
  });

  it('keeps at most five fix-next items', () => {
    const findings = Array.from({ length: 9 }, (_, index) =>
      finding({ ruleId: `rule-${String(index)}` }),
    );
    expect(grade(inputs({ findings })).fixNext).toHaveLength(5);
  });
});

describe('the health policy in automate.config.json', () => {
  const base = {
    detectorVersion: 1,
    ecosystem: null,
    language: null,
    packageManager: null,
    commands: [],
    artifactGlobs: [],
    coverageGlobs: [],
    coverageFormats: [],
    excludedCells: [],
    targets: { testsPerCell: {}, coverageTarget: {} },
  };

  it('is carried onto the profile when declared, and absent otherwise', () => {
    const declared = mergeConfig(base, {
      version: 1,
      health: { weights: { runtime: 0 }, gate: { minLetter: 'B' } },
    });
    expect(declared.profile.health).toEqual({ weights: { runtime: 0 }, gate: { minLetter: 'B' } });
    expect(mergeConfig(base, { version: 1 }).profile).toEqual(base);
  });

  it('refuses a gate the grade does not have', () => {
    expect(() => mergeConfig(base, { version: 1, health: { disabledGates: ['flaky'] } })).toThrow();
  });
});
