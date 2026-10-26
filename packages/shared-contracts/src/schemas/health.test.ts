import { describe, expect, it } from 'vitest';
import {
  BUILT_IN_REPORT_FORMATS,
  CORE_HEALTH_DIMENSIONS,
  EVAL_UPLOAD_FORMATS,
  FINDING_REPORT_FORMATS,
  GitRepositoryUrlSchema,
  HEALTH_DIMENSIONS,
  HEALTH_DIMENSION_LABELS,
  HEALTH_EVIDENCE_FORMATS,
  HEALTH_METRIC_FORMATS,
  HEALTH_REPORT_FORMATS,
  LINE_COVERAGE_REPORT_FORMATS,
  MAX_TRACE_RETENTION_DAYS,
  OPT_IN_HEALTH_DIMENSIONS,
  isEvalUploadFormat,
  isFindingReportFormat,
  isOptInDimension,
  isUploadReportFormat,
  HealthGradeSchema,
  HealthPolicySchema,
  HealthScanStartedSchema,
  HealthUploadResultSchema,
  PortfolioSchema,
  ProjectHealthSchema,
  TriageFindingBodySchema,
  type HealthGrade,
} from './health.js';

function grade(overrides: Partial<HealthGrade> = {}): HealthGrade {
  return {
    score: 90,
    letter: 'A',
    incomplete: false,
    incompleteReason: null,
    cappedBy: 'security',
    cappingValue: 90,
    limiter: 'Limited by Security',
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
    gates: [
      { id: 'open-secret', tripped: false, enabled: true, statement: 'No open secrets' },
      { id: 'fixable-critical-vulnerability', tripped: false, enabled: true, statement: 'none' },
      { id: 'failing-tests', tripped: false, enabled: true, statement: 'none' },
    ],
    fixNext: [],
    ...overrides,
  };
}

describe('the health grade contract', () => {
  it('labels every dimension', () => {
    expect(Object.keys(HEALTH_DIMENSION_LABELS).sort()).toEqual([...HEALTH_DIMENSIONS].sort());
  });

  it('splits the dimensions into seven core and five opt-in, with no overlap', () => {
    expect(CORE_HEALTH_DIMENSIONS).toHaveLength(7);
    expect(OPT_IN_HEALTH_DIMENSIONS).toHaveLength(5);
    expect(HEALTH_DIMENSIONS).toEqual([...CORE_HEALTH_DIMENSIONS, ...OPT_IN_HEALTH_DIMENSIONS]);
    for (const dimension of OPT_IN_HEALTH_DIMENSIONS)
      expect(isOptInDimension(dimension)).toBe(true);
    for (const dimension of CORE_HEALTH_DIMENSIONS) expect(isOptInDimension(dimension)).toBe(false);
  });

  it('requires a complete grade to name what limited it, and lets an incomplete one name nothing', () => {
    expect(HealthGradeSchema.safeParse(grade()).success).toBe(true);
    expect(HealthGradeSchema.safeParse(grade({ cappedBy: null })).success).toBe(false);
    expect(
      HealthGradeSchema.safeParse(
        grade({
          incomplete: true,
          incompleteReason: 'no security',
          cappedBy: null,
          score: null,
          letter: null,
        }),
      ).success,
    ).toBe(true);
  });

  it('carries a grade on every response that serves one', () => {
    const report = {
      id: 'r',
      format: 'sarif',
      source: 'ci',
      toolKey: 'sarif:x',
      tools: [],
      commitSha: null,
      findingCount: 0,
      receivedAt: '2026-10-23T00:00:00.000Z',
    };
    expect(
      ProjectHealthSchema.safeParse({
        projectId: 'p',
        name: 'n',
        branch: 'main',
        evaluatedAt: '2026-10-23T00:00:00.000Z',
        grade: grade(),
        reports: [report],
      }).success,
    ).toBe(true);
    expect(
      HealthUploadResultSchema.safeParse({
        reportId: 'r',
        branch: 'main',
        toolKey: 'k',
        findings: { new: 1, persisting: 0, fixed: 0 },
        metrics: 0,
        grade: grade(),
      }).success,
    ).toBe(true);
    expect(PortfolioSchema.safeParse({ projects: [] }).success).toBe(true);
    expect(
      HealthScanStartedSchema.safeParse({ runIds: [], scanners: [], notConfigured: ['semgrep'] })
        .success,
    ).toBe(true);
  });

  it('refuses a policy gate the grade does not have, and a weight out of range', () => {
    expect(
      HealthPolicySchema.safeParse({ disabledGates: ['open-secret'], weights: { runtime: 0 } })
        .success,
    ).toBe(true);
    expect(HealthPolicySchema.safeParse({ disabledGates: ['flaky'] }).success).toBe(false);
    expect(HealthPolicySchema.safeParse({ weights: { security: 101 } }).success).toBe(false);
  });
});

describe('TriageFindingBodySchema', () => {
  it.each([
    [{ state: 'open' }, true],
    [{ state: 'false_positive', reason: 'test fixture' }, true],
    [{ state: 'suppressed', reason: 'vendored' }, true],
    [{ state: 'accepted', reason: 'vendor fix due', expiresAt: '2026-12-01T00:00:00.000Z' }, true],
    [{ state: 'suppressed' }, false],
    [{ state: 'accepted', reason: 'no date' }, false],
    [{ state: 'fixed', reason: 'only a scan decides fixed' }, false],
    [{ state: 'false_positive', reason: '   ' }, false],
  ])('%j → %s', (body, valid) => {
    expect(TriageFindingBodySchema.safeParse(body).success).toBe(valid);
  });
});

describe('GitRepositoryUrlSchema', () => {
  it.each([
    ['https://github.com/o/r.git', true],
    ['ssh://git@github.com/o/r.git', true],
    ['git@gitlab.example.com:group/sub/r.git', true],
    ['https://github.com/', false],
    ['http://github.com/o/r.git', false],
    ['file:///etc/passwd', false],
    ['ext::sh -c id', false],
    ['/srv/repos/other', false],
    ['-uhttps://x', false],
    ['https://user:pass@github.com/o/r.git', false],
    ['https://token@github.com/o/r.git', false],
    ['ssh://git:secret@github.com/o/r.git', false],
    ['https://github.com/o/r.git\n', false],
    ['https://github.com/o/r\u0000.git', false],
    ['not a url at all', false],
  ])('%j → %s', (url, valid) => {
    expect(GitRepositoryUrlSchema.safeParse(url).success).toBe(valid);
  });
});

describe('the health report formats', () => {
  it('reads every metric, evidence and SARIF format once, and finding formats are a subset', () => {
    expect(HEALTH_REPORT_FORMATS).toEqual([
      'sarif',
      ...HEALTH_METRIC_FORMATS,
      ...HEALTH_EVIDENCE_FORMATS,
      ...BUILT_IN_REPORT_FORMATS,
    ]);
    expect(new Set(HEALTH_REPORT_FORMATS).size).toBe(HEALTH_REPORT_FORMATS.length);
    for (const format of FINDING_REPORT_FORMATS) expect(HEALTH_REPORT_FORMATS).toContain(format);
    for (const format of LINE_COVERAGE_REPORT_FORMATS)
      expect(HEALTH_METRIC_FORMATS).toContain(format);
    expect(isFindingReportFormat('axe-json')).toBe(true);
    expect(isFindingReportFormat('vex')).toBe(false);
    expect(isFindingReportFormat('jscpd')).toBe(false);
  });

  it('accepts the eval formats at the upload door and keeps the built-in format off it', () => {
    for (const format of EVAL_UPLOAD_FORMATS) {
      expect(HEALTH_EVIDENCE_FORMATS).toContain(format);
      expect(isEvalUploadFormat(format)).toBe(true);
      expect(isUploadReportFormat(format)).toBe(true);
    }
    expect(isEvalUploadFormat('sarif')).toBe(false);
    expect(isUploadReportFormat('automate-agent-config')).toBe(false);
    expect(isFindingReportFormat('automate-agent-config')).toBe(true);
  });

  it('bounds the agents policy: retention to 90 days, ratios to 0–1, prices to admin-set rows', () => {
    const parse = (agents: unknown) => HealthPolicySchema.safeParse({ agents }).success;
    expect(
      parse({
        storePrompts: true,
        maxEvalRegression: 0.05,
        minEvalAttempts: 20,
        gateOnEvals: true,
        gateOnRuntime: true,
        budgets: { maxCostPerRunUsd: 0.1, maxToolFailureRate: 0.2 },
        prices: [
          { provider: 'openai', model: 'gpt-4o', inputPerMillionUsd: 2.5, outputPerMillionUsd: 10 },
        ],
        storeTraceContent: false,
        traceRetentionDays: MAX_TRACE_RETENTION_DAYS,
      }),
    ).toBe(true);
    expect(parse({ traceRetentionDays: MAX_TRACE_RETENTION_DAYS + 1 })).toBe(false);
    expect(parse({ maxEvalRegression: 1.5 })).toBe(false);
    expect(parse({ budgets: { maxErrorRate: 2 } })).toBe(false);
    expect(
      parse({
        prices: [{ provider: null, model: 'm', inputPerMillionUsd: -1, outputPerMillionUsd: 0 }],
      }),
    ).toBe(false);
  });

  it('bounds a diff-coverage minimum to a percentage', () => {
    expect(HealthPolicySchema.safeParse({ gate: { minDiffCoverage: 80 } }).success).toBe(true);
    expect(HealthPolicySchema.safeParse({ gate: { minDiffCoverage: 101 } }).success).toBe(false);
    expect(HealthPolicySchema.safeParse({ gate: { minDiffCoverage: -1 } }).success).toBe(false);
  });
});
