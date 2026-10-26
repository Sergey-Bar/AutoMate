import { describe, expect, it } from 'vitest';
import { CanonicalFindingSchema, DimensionMetricSchema } from '@automate/shared-contracts';
import { HealthReportError, MAX_HEALTH_REPORT_BYTES } from './sarif.js';
import { MAX_MUTATION_FINDINGS, parseStrykerReport } from './mutation.js';

const bytes = (document: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(document));

function errorCode(run: () => unknown): string | null {
  try {
    run();
    return null;
  } catch (error) {
    return error instanceof HealthReportError ? error.code : 'not-a-health-error';
  }
}

const mutant = (status: string, line = 1, mutatorName = 'ConditionalExpression', column = 1) => ({
  id: `${status}-${String(line)}-${String(column)}`,
  mutatorName,
  replacement: 'true',
  location: { start: { line, column }, end: { line, column: column + 4 } },
  status,
});

const REPORT = {
  schemaVersion: '2',
  thresholds: { high: 80, low: 60 },
  projectRoot: 'C:\\work\\app',
  framework: { name: 'StrykerJS', version: '8.2.6' },
  files: {
    'C:\\work\\app\\src\\math.ts': {
      language: 'typescript',
      source: '',
      mutants: [
        mutant('Killed', 3),
        mutant('Killed', 4),
        mutant('Killed', 5),
        mutant('Timeout', 6),
        mutant('Survived', 9, 'EqualityOperator', 7),
        mutant('Survived', 9, 'ArithmeticOperator', 2),
        mutant('NoCoverage', 12, 'BlockStatement'),
        mutant('Ignored', 14),
        mutant('CompileError', 15),
        mutant('RuntimeError', 16),
        mutant('Pending', 17),
        mutant('Unheard', 18),
        'not a mutant',
      ],
    },
    'src/clean.ts': { language: 'typescript', mutants: [mutant('Killed'), mutant('Killed', 2)] },
    'src/uncovered.ts': {
      mutants: [
        { status: 'NoCoverage', location: { start: { line: 2.5 } } },
        mutant('NoCoverage', 0),
      ],
    },
    'src/broken.ts': 'not a file',
  },
};

describe('parseStrykerReport', () => {
  it('counts every status and computes the schema-defined scores exactly', () => {
    const parsed = parseStrykerReport(bytes(REPORT));
    expect(parsed.summary).toEqual({
      killed: 5,
      survived: 2,
      timeout: 1,
      noCoverage: 3,
      ignored: 1,
      runtimeErrors: 1,
      compileErrors: 1,
      pending: 1,
      total: 15,
      // detected 6 / valid (6 detected + 5 undetected) = 11
      mutationScore: (6 / 11) * 100,
      // detected 6 / covered (6 detected + 2 survived) = 8
      coveredScore: (6 / 8) * 100,
    });
    expect(parsed.metrics).toHaveLength(1);
    expect(DimensionMetricSchema.parse(parsed.metrics[0])).toEqual({
      dimension: 'test-effectiveness',
      metric: 'mutation-score',
      tool: { name: 'StrykerJS', version: '8.2.6' },
      score: (6 / 11) * 100,
      summary: 'Mutation score 54.5%: 6 of 11 valid mutants detected (75.0% of covered)',
    });
  });

  it('reports one finding per file with survivors, on the first survivor, most survivors first', () => {
    const parsed = parseStrykerReport(bytes(REPORT));
    for (const finding of parsed.findings) CanonicalFindingSchema.parse(finding);
    expect(parsed.findings.map((finding) => [finding.path, finding.line, finding.message])).toEqual(
      [
        [
          'src/math.ts',
          9,
          '3 surviving mutants (1 with no coverage); first: ArithmeticOperator at line 9',
        ],
        ['src/uncovered.ts', null, '2 surviving mutants (2 with no coverage); first: a mutant'],
      ],
    );
    expect(parsed.findings[0]).toMatchObject({
      tool: 'StrykerJS',
      ruleId: 'stryker/surviving-mutant',
      kind: 'issue',
      severity: 'low',
      dimension: 'test-effectiveness',
      fixAvailable: null,
      helpUri:
        'https://stryker-mutator.io/docs/mutation-testing-elements/mutant-states-and-metrics/',
    });
  });

  it('keeps the fingerprint on the file, so more or fewer survivors are the same finding', () => {
    const fewer = {
      ...REPORT,
      files: { 'src/math.ts': { mutants: [mutant('Survived', 40, 'StringLiteral')] } },
    };
    const before = parseStrykerReport(bytes(REPORT)).findings[0]?.fingerprint;
    const after = parseStrykerReport(bytes(fewer)).findings[0];
    expect(after?.fingerprint).toBe(before);
    expect(after?.message).toBe('1 surviving mutant; first: StringLiteral at line 40');
  });

  it('scores 100 when every mutant was killed', () => {
    const parsed = parseStrykerReport(
      bytes({ files: { 'a.ts': { mutants: [mutant('Killed'), mutant('Killed', 2)] } } }),
    );
    expect(parsed.summary.mutationScore).toBe(100);
    expect(parsed.metrics[0]).toMatchObject({
      score: 100,
      tool: { name: 'stryker', version: null },
      summary: 'Mutation score 100.0%: 2 of 2 valid mutants detected (100.0% of covered)',
    });
    expect(parsed.findings).toEqual([]);
  });

  it('leaves the dimension unmeasured when no mutant was valid, rather than scoring 0', () => {
    const parsed = parseStrykerReport(
      bytes({ files: { 'a.ts': { mutants: [mutant('CompileError'), mutant('Ignored')] } } }),
    );
    expect(parsed.metrics).toEqual([]);
    expect(parsed.summary).toMatchObject({ mutationScore: null, coveredScore: null, total: 2 });
  });

  it('gives no covered score when nothing was covered', () => {
    const parsed = parseStrykerReport(
      bytes({ files: { 'a.ts': { mutants: [mutant('NoCoverage')] } } }),
    );
    expect(parsed.summary).toMatchObject({ mutationScore: 0, coveredScore: null });
    expect(parsed.metrics[0]?.summary).toBe('Mutation score 0.0%: 0 of 1 valid mutants detected');
  });

  it('caps findings at the top files by survivors, ties broken by path', () => {
    const files = Object.fromEntries(
      Array.from({ length: MAX_MUTATION_FINDINGS + 5 }, (_, index) => [
        `src/f${String(index).padStart(3, '0')}.ts`,
        { mutants: Array.from({ length: index === 52 ? 3 : 1 }, () => mutant('Survived')) },
      ]),
    );
    const parsed = parseStrykerReport(bytes({ projectRoot: '/repo/', files }));
    expect(parsed.findings).toHaveLength(MAX_MUTATION_FINDINGS);
    expect(parsed.findings[0]?.path).toBe('src/f052.ts');
    expect(parsed.findings[1]?.path).toBe('src/f000.ts');
    expect(parsed.findings.at(-1)?.path).toBe('src/f048.ts');
  });

  it('strips a forward-slash project root and truncates very long paths', () => {
    const long = `/repo/${'d/'.repeat(600)}x.ts`;
    const parsed = parseStrykerReport(
      bytes({ projectRoot: '/repo', files: { [long]: { mutants: [mutant('Survived')] } } }),
    );
    expect(parsed.findings[0]?.path?.startsWith('d/d/')).toBe(true);
    expect(parsed.findings[0]?.path).toHaveLength(1000);
  });

  it('refuses what is not a mutation report', () => {
    expect(errorCode(() => parseStrykerReport(new TextEncoder().encode('{')))).toBe('malformed');
    expect(errorCode(() => parseStrykerReport(bytes([])))).toBe('malformed');
    expect(errorCode(() => parseStrykerReport(bytes({ schemaVersion: '2' })))).toBe('malformed');
    expect(errorCode(() => parseStrykerReport(new Uint8Array(MAX_HEALTH_REPORT_BYTES + 1)))).toBe(
      'too_large',
    );
  });
});
