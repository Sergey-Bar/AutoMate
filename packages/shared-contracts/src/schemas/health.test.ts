import { describe, expect, it } from 'vitest';
import {
  AiGovernancePolicySchema,
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
  ModelPriceSchema,
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
  it('labels every dimension, with a label a reader can see and no two alike', () => {
    expect(Object.keys(HEALTH_DIMENSION_LABELS).sort()).toEqual([...HEALTH_DIMENSIONS].sort());
    const labels = Object.values(HEALTH_DIMENSION_LABELS);
    for (const label of labels) expect(label).toMatch(/^[A-Z][A-Za-z ]+$/u);
    expect(new Set(labels).size).toBe(labels.length);
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
    // The issue names the field, so a client can say what is wrong rather than that something is.
    expect(HealthGradeSchema.safeParse(grade({ cappedBy: null })).error?.issues).toEqual([
      expect.objectContaining({
        code: 'custom',
        path: ['cappedBy'],
        message: 'a complete grade always names what limited it',
      }),
    ]);
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

  it('names the field a decision is missing, and trims the owner', () => {
    const issues = (body: unknown) => TriageFindingBodySchema.safeParse(body).error?.issues;
    expect(issues({ state: 'suppressed' })).toEqual([
      expect.objectContaining({
        code: 'custom',
        path: ['reason'],
        message: 'a triage decision needs a reason',
      }),
    ]);
    expect(issues({ state: 'accepted', reason: 'vendor fix due' })).toEqual([
      expect.objectContaining({
        code: 'custom',
        path: ['expiresAt'],
        message: 'an accepted risk needs an expiry',
      }),
    ]);
    expect(TriageFindingBodySchema.parse({ state: 'open', owner: '  ana  ' }).owner).toBe('ana');
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
    // A dash is refused only where git would read the value as an option.
    ['https://github.com/o/r-', true],
    // An scp-style URL is the whole value, not a part of it.
    ['!git@github.com:o/r.git', false],
    ['git@github.com:o/r.git!', false],
    ['ssh:///o/r.git', false],
  ])('%j → %s', (url, valid) => {
    expect(GitRepositoryUrlSchema.safeParse(url).success).toBe(valid);
  });

  it('says which rule refused a URL', () => {
    const shape = 'a repository URL has no whitespace, control characters or leading dash';
    const transport =
      'only https://, ssh:// or git@host:owner/repo URLs without credentials can be cloned';
    const messages = (url: string) =>
      GitRepositoryUrlSchema.safeParse(url).error?.issues.map((issue) => issue.message);
    expect(messages('-uhttps://x')).toContain(shape);
    // By code point: DEL is a control character the URL parser would percent-encode and keep.
    expect(messages('https://github.com/o/r\u007f.git')).toEqual([shape]);
    expect(messages('file:///etc/passwd')).toEqual([transport]);
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

describe('the names an administrator types into a policy', () => {
  it('are trimmed, so a label or a model matches what a provider sends', () => {
    expect(
      AiGovernancePolicySchema.parse({ agentLabels: [' agent '], assistedLabels: ['  ai  '] }),
    ).toMatchObject({ agentLabels: ['agent'], assistedLabels: ['ai'] });
    expect(
      ModelPriceSchema.parse({
        provider: ' openai ',
        model: ' gpt-4o ',
        inputPerMillionUsd: 2.5,
        outputPerMillionUsd: 10,
      }),
    ).toMatchObject({ provider: 'openai', model: 'gpt-4o' });
    expect(
      HealthPolicySchema.parse({ delivery: { productionEnvironments: [' production '] } }).delivery
        ?.productionEnvironments,
    ).toEqual(['production']);
  });
});
