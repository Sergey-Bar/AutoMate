import { z } from 'zod/v4';

/**
 * Repository health, as the wire contract.
 *
 * ## Seven dimensions, every one measured by a tool somebody else wrote
 *
 * A dimension's number comes from a scanner's own output — Semgrep, gitleaks, Trivy,
 * OSV-Scanner, a linter's SARIF, jscpd, OpenSSF Scorecard, Lighthouse, k6, coverage, and
 * the existing QA score. Nothing here analyses source. A dimension no tool reported on is
 * **not measured**, and a not-measured dimension is excluded from the grade rather than
 * scored as zero or as a hundred: both of those are a number nobody measured.
 *
 * ## The grade always names what limited it
 *
 * The overall score is a weighted geometric mean, the same property the QA score relies on:
 * a zero cannot be averaged away. For the same reason the total alone cannot be diagnosed,
 * so `cappedBy` is required, and a tripped hard gate is reported as the limiter.
 *
 * ## Five more dimensions, each opt-in
 *
 * `delivery`, `ai-governance`, `test-effectiveness`, `agent-quality` and `accessibility`
 * are measured and shown like the first seven, but their default weight is `0`: they are
 * scorecards beside the grade until a project's policy gives them a weight. A weight of
 * `0` drops a term from the geometric mean, so adding them changed no existing grade
 * (invariant HEALTH-3).
 */
export const CORE_HEALTH_DIMENSIONS = [
  'security',
  'tests',
  'code-quality',
  'dependencies',
  'coverage',
  'supply-chain',
  'runtime',
] as const;
export const OPT_IN_HEALTH_DIMENSIONS = [
  'delivery',
  'ai-governance',
  'test-effectiveness',
  'agent-quality',
  'accessibility',
] as const;
export const HEALTH_DIMENSIONS = [...CORE_HEALTH_DIMENSIONS, ...OPT_IN_HEALTH_DIMENSIONS] as const;
export type HealthDimension = (typeof HEALTH_DIMENSIONS)[number];
export type OptInHealthDimension = (typeof OPT_IN_HEALTH_DIMENSIONS)[number];
export const HealthDimensionSchema = z.enum(HEALTH_DIMENSIONS);

/** Whether a dimension counts only when a policy weights it. */
export function isOptInDimension(dimension: HealthDimension): dimension is OptInHealthDimension {
  return (OPT_IN_HEALTH_DIMENSIONS as readonly string[]).includes(dimension);
}

/** What a reader sees. One table, so the API's limiter sentence and the UI agree. */
export const HEALTH_DIMENSION_LABELS: Readonly<Record<HealthDimension, string>> = {
  security: 'Security',
  tests: 'Tests',
  'code-quality': 'Code quality',
  dependencies: 'Dependencies',
  coverage: 'Coverage',
  'supply-chain': 'Supply chain',
  runtime: 'Runtime',
  delivery: 'Delivery',
  'ai-governance': 'AI governance',
  'test-effectiveness': 'Test effectiveness',
  'agent-quality': 'Agent quality',
  accessibility: 'Accessibility',
};

/** Most severe first. The order the findings table sorts by. */
export const FINDING_SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'] as const;
export type FindingSeverity = (typeof FINDING_SEVERITIES)[number];
export const FindingSeveritySchema = z.enum(FINDING_SEVERITIES);

/**
 * What a finding *is*, independent of which dimension it lands in.
 *
 * Two hard gates key on it: an open `secret`, and a `vulnerability` that is critical and has
 * a fix available. `issue` is everything else a scanner reports.
 */
export const FINDING_KINDS = ['secret', 'vulnerability', 'issue'] as const;
export type FindingKind = (typeof FINDING_KINDS)[number];
export const FindingKindSchema = z.enum(FINDING_KINDS);

/**
 * `open` and `fixed` are decided by scans; the other three are decided by a person, and each
 * of those carries a reason. Only `open` counts against the grade.
 */
export const FINDING_STATES = [
  'open',
  'fixed',
  'suppressed',
  'accepted',
  'false_positive',
] as const;
export type FindingState = (typeof FINDING_STATES)[number];
export const FindingStateSchema = z.enum(FINDING_STATES);

/** Which scanner, and which version of it, said something. */
export const HealthToolSchema = z.object({
  name: z.string().min(1).max(100),
  version: z.string().min(1).max(100).nullable(),
});
export type HealthTool = z.infer<typeof HealthToolSchema>;

/**
 * One finding as a reporter adapter normalised it.
 *
 * `fingerprint` is the identity across scans: it is what makes a finding `new`, `persisting`
 * or `fixed`, and what triage attaches to. It comes from the tool's own
 * `partialFingerprints` when there are any.
 */
export const CanonicalFindingSchema = z.object({
  fingerprint: z.string().min(1).max(200),
  tool: z.string().min(1).max(100),
  ruleId: z.string().min(1).max(300),
  kind: FindingKindSchema,
  severity: FindingSeveritySchema,
  dimension: HealthDimensionSchema,
  path: z.string().max(1000).nullable(),
  line: z.number().int().min(1).nullable(),
  message: z.string().min(1).max(4000),
  /** The tool's own rule documentation, which is the fix guidance — never ours. */
  helpUri: z.string().max(2000).nullable(),
  /** `null` when the tool does not say. Only `true` trips the fixable-critical gate. */
  fixAvailable: z.boolean().nullable(),
});
export type CanonicalFinding = z.infer<typeof CanonicalFindingSchema>;

/**
 * A number a tool reported for a dimension, already on a 0–100 scale.
 *
 * `summary` is one sentence a reader can check against the tool's own report: "4.2% of
 * lines duplicated", "Scorecard 6.1 / 10".
 */
export const DimensionMetricSchema = z.object({
  dimension: HealthDimensionSchema,
  metric: z.string().min(1).max(100),
  tool: HealthToolSchema,
  score: z.number().min(0).max(100),
  summary: z.string().min(1).max(500),
});
export type DimensionMetric = z.infer<typeof DimensionMetricSchema>;

export const HEALTH_LETTERS = ['A+', 'A', 'B', 'C', 'D', 'F'] as const;
export type HealthLetter = (typeof HEALTH_LETTERS)[number];
export const HealthLetterSchema = z.enum(HEALTH_LETTERS);

/** The three conditions no score can average away. Each caps the overall grade at `D`. */
export const HEALTH_GATES = [
  'open-secret',
  'fixable-critical-vulnerability',
  'failing-tests',
] as const;
export type HealthGateId = (typeof HEALTH_GATES)[number];
export const HealthGateIdSchema = z.enum(HEALTH_GATES);

export const HealthGateSchema = z.object({
  id: HealthGateIdSchema,
  tripped: z.boolean(),
  /** Disabled by the repository's policy. A disabled gate is shown, never hidden. */
  enabled: z.boolean(),
  statement: z.string().min(1),
});
export type HealthGate = z.infer<typeof HealthGateSchema>;

export const DimensionScoreSchema = z.object({
  dimension: HealthDimensionSchema,
  measured: z.boolean(),
  /** `null` when not measured. Never a default. */
  score: z.number().min(0).max(100).nullable(),
  letter: HealthLetterSchema.nullable(),
  weight: z.number().min(0),
  tools: z.array(HealthToolSchema).readonly(),
  /** Open findings by severity, for a findings-based dimension. */
  openFindings: z.record(FindingSeveritySchema, z.number().int().min(0)),
  /** One sentence per contribution, metric or findings. Empty when not measured. */
  summary: z.array(z.string().min(1)).readonly(),
});
export type DimensionScore = z.infer<typeof DimensionScoreSchema>;

/** What to fix, and what fixing it is worth to the overall score. */
export const FixNextSchema = z.object({
  /** `rule:<dimension>:<tool>:<ruleId>`, `gate:<id>` or `metric:<dimension>:<metric>`. */
  key: z.string().min(1),
  dimension: HealthDimensionSchema,
  title: z.string().min(1),
  /** Open findings this item would close; `0` for a metric. */
  findings: z.number().int().min(0),
  /** Points of overall score gained, recomputed by the grade function itself. */
  gain: z.number().min(0).max(100),
  helpUri: z.string().nullable(),
});
export type FixNext = z.infer<typeof FixNextSchema>;

export const HealthGradeSchema = z
  .object({
    /** `null` while incomplete: a letter over one dimension is not a repository grade. */
    score: z.number().min(0).max(100).nullable(),
    letter: HealthLetterSchema.nullable(),
    incomplete: z.boolean(),
    /** Why incomplete, in a sentence. `null` when complete. */
    incompleteReason: z.string().min(1).nullable(),
    /** A gate id when a gate capped the grade, otherwise the dimension that limited it. */
    cappedBy: z.union([HealthDimensionSchema, HealthGateIdSchema]).nullable(),
    cappingValue: z.number().min(0).max(100).nullable(),
    /** One sentence: "Limited by Security — 2 open secrets". */
    limiter: z.string().min(1).nullable(),
    dimensions: z.array(DimensionScoreSchema).length(HEALTH_DIMENSIONS.length).readonly(),
    gates: z.array(HealthGateSchema).length(HEALTH_GATES.length).readonly(),
    fixNext: z.array(FixNextSchema).max(5).readonly(),
  })
  .superRefine((grade, ctx) => {
    if (!grade.incomplete && grade.cappedBy === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['cappedBy'],
        message: 'a complete grade always names what limited it',
      });
    }
  });
export type HealthGrade = z.infer<typeof HealthGradeSchema>;

/**
 * The `health` key of `automate.config.json`.
 *
 * Weights reweight measured dimensions; a weight of `0` drops a dimension from the grade on
 * purpose, which is different from it being unmeasured and is shown as such. `gate` is the
 * pull-request policy.
 */
/**
 * The `aiGovernance` block of the health policy: the pull-request rules for change an AI agent
 * wrote, and the labels that mark it. Off unless `enabled` is `true`. Read by
 * `evaluateAiGovernance` in `@automate/reporting`; a human pull request is never subject to it.
 */
export const AiGovernancePolicySchema = z.object({
  enabled: z.boolean().default(false),
  /** Labels that mark a pull request agent-authored, matched case-insensitively. */
  agentLabels: z.array(z.string().trim().min(1).max(100)).max(50).optional(),
  /** Labels that mark a pull request AI-assisted. */
  assistedLabels: z.array(z.string().trim().min(1).max(100)).max(50).optional(),
  /** Default `true`: an agent's pull request needs one approval by a human other than its author. */
  requireHumanApproval: z.boolean().optional(),
  requireTestsTouched: z.boolean().optional(),
  /** 0–100, the share of the change's executable added lines that ran. */
  minDiffCoverage: z.number().min(0).max(100).optional(),
  maxNewHighOrCritical: z.number().int().min(0).optional(),
  /** Default `['agent-authored']`. */
  applyTo: z
    .array(z.enum(['agent-authored', 'ai-assisted']))
    .min(1)
    .max(2)
    .optional(),
  /** Default `'human'`; `'agent-authored'` is the strict choice. */
  treatUnknownAs: z.enum(['human', 'agent-authored']).optional(),
});

/** One model's price, configured by an administrator. No price is built in. */
export const ModelPriceSchema = z.object({
  provider: z.string().trim().min(1).max(100).nullable(),
  model: z.string().trim().min(1).max(200),
  inputPerMillionUsd: z.number().min(0).max(100_000),
  outputPerMillionUsd: z.number().min(0).max(100_000),
});
export type ModelPriceConfig = z.infer<typeof ModelPriceSchema>;

/** The per-agent runtime budgets; each is checked per agent, never only on the average. */
export const AgentRuntimeBudgetsSchema = z.object({
  maxCostPerRunUsd: z.number().min(0).optional(),
  maxTokensPerRun: z.number().min(0).optional(),
  /** As a ratio, 0–1. */
  maxToolFailureRate: z.number().min(0).max(1).optional(),
  maxP95LatencyMs: z.number().min(0).optional(),
  /** As a ratio, 0–1. */
  maxErrorRate: z.number().min(0).max(1).optional(),
});

/** The longest a project may keep GenAI spans, in days. */
export const MAX_TRACE_RETENTION_DAYS = 90;
export const DEFAULT_TRACE_RETENTION_DAYS = 14;

/**
 * Agent quality: evals, traces and runtime budgets. Nothing here is on by default — prompts
 * and span content are not stored unless asked for, and neither the eval comparison nor the
 * runtime budgets fail a pull request unless `gateOnEvals` / `gateOnRuntime` say so.
 */
export const AgentsPolicySchema = z.object({
  /** Keep each eval case's prompt text. Default `false`: only its sha256 is kept. */
  storePrompts: z.boolean().optional(),
  /** The allowed drop in a suite's overall pass rate against the default branch, 0–1. */
  maxEvalRegression: z.number().min(0).max(1).optional(),
  /** Decided attempts each side needs before a passing comparison is claimed. */
  minEvalAttempts: z.number().int().min(1).max(100_000).optional(),
  /** A failing eval comparison fails the pull-request gate. */
  gateOnEvals: z.boolean().optional(),
  /** A runtime budget breach fails the pull-request gate. */
  gateOnRuntime: z.boolean().optional(),
  budgets: AgentRuntimeBudgetsSchema.optional(),
  prices: z.array(ModelPriceSchema).max(500).optional(),
  /** Keep span prompt/completion content, redacted and capped. Default `false`. */
  storeTraceContent: z.boolean().optional(),
  traceRetentionDays: z.number().int().min(1).max(MAX_TRACE_RETENTION_DAYS).optional(),
});
export type AgentsPolicy = z.infer<typeof AgentsPolicySchema>;

export const HealthPolicySchema = z.object({
  weights: z.partialRecord(HealthDimensionSchema, z.number().min(0).max(100)).optional(),
  disabledGates: z.array(HealthGateIdSchema).optional(),
  gate: z
    .object({
      minLetter: HealthLetterSchema.optional(),
      maxNewCritical: z.number().int().min(0).optional(),
      maxNewHigh: z.number().int().min(0).optional(),
      /**
       * The least share of a change's executable added lines that must have run, 0–100. With
       * a minimum set, a commit whose diff coverage was not measured fails: an absent number
       * is never read as a pass.
       */
      minDiffCoverage: z.number().min(0).max(100).optional(),
    })
    .optional(),
  /**
   * Delivery performance (DORA and pull-request flow). `productionEnvironments` here wins over
   * the delivery source's own list, because this file is versioned with the code it describes.
   * The four limits are the DORA scorecard's policy; with `gateOnDelivery` a failing DORA
   * scorecard fails the pull-request gate. A scorecard with too little data never fails it.
   */
  delivery: z
    .object({
      productionEnvironments: z.array(z.string().trim().min(1).max(100)).min(1).max(20).optional(),
      /** As a ratio, 0–1. */
      maxChangeFailureRate: z.number().min(0).max(1).optional(),
      maxLeadTimeHours: z.number().min(0).optional(),
      minDeploysPerWeek: z.number().min(0).optional(),
      maxRecoveryHours: z.number().min(0).optional(),
      staleAfterDays: z.number().int().min(1).max(365).optional(),
      gateOnDelivery: z.boolean().optional(),
    })
    .optional(),
  /**
   * AI-code governance: the pull-request rules for change an AI agent wrote, and the labels
   * that mark it. Off unless `enabled`; a human pull request is never subject to the rules.
   */
  aiGovernance: AiGovernancePolicySchema.optional(),
  /** Agent quality: eval storage and gating, trace content and retention, prices, budgets. */
  agents: AgentsPolicySchema.optional(),
});
export type HealthPolicy = z.infer<typeof HealthPolicySchema>;
export type DeliveryPolicy = NonNullable<HealthPolicy['delivery']>;
export type AiGovernancePolicyBlock = NonNullable<HealthPolicy['aiGovernance']>;

// ─── The health API ─────────────────────────────────────────────────────────

/** Where a report came from: a CI upload, a scan this install ran, or a person. */
export const HEALTH_REPORT_SOURCES = ['ci', 'runner', 'manual'] as const;
export const HealthReportSourceSchema = z.enum(HEALTH_REPORT_SOURCES);

/** Formats whose report is numbers only: each becomes one or more `DimensionMetric`s. */
export const HEALTH_METRIC_FORMATS = [
  'jscpd',
  'scorecard',
  'lighthouse',
  'k6',
  'istanbul-summary',
  'lcov',
  'cobertura',
  'jacoco-xml',
  'go-coverprofile',
] as const;
export type HealthMetricFormat = (typeof HEALTH_METRIC_FORMATS)[number];

/** The four coverage formats that also carry line numbers, stored for diff coverage. */
export const LINE_COVERAGE_REPORT_FORMATS = [
  'lcov',
  'cobertura',
  'jacoco-xml',
  'go-coverprofile',
] as const satisfies readonly HealthMetricFormat[];

/**
 * Eval run reports: three tools' native JSON, and Automate's own run shape — which the
 * built-in eval runner writes, so its runs enter through this same door (one writer).
 */
export const EVAL_UPLOAD_FORMATS = [
  'promptfoo-json',
  'deepeval-json',
  'inspect-eval-json',
  'automate-eval-json',
] as const;
export type EvalUploadFormat = (typeof EVAL_UPLOAD_FORMATS)[number];

export function isEvalUploadFormat(format: string): format is EvalUploadFormat {
  return (EVAL_UPLOAD_FORMATS as readonly string[]).includes(format);
}

/**
 * Formats that are neither SARIF nor a plain metric: an inventory, a statement about one, a
 * build attestation, a mutation run, an accessibility run, a diff, an agent-skill scan.
 */
export const HEALTH_EVIDENCE_FORMATS = [
  'cyclonedx-json',
  'spdx-json',
  'vex',
  'slsa-provenance',
  'stryker-mutation',
  'axe-json',
  'git-diff',
  'skillspector-json',
  ...EVAL_UPLOAD_FORMATS,
] as const;

/**
 * Formats only this product writes, never accepted at the upload door: the built-in
 * agent-config scanner's findings are stored as a report of this kind so the finding
 * lifecycle and the grade read them like any scanner's.
 */
export const BUILT_IN_REPORT_FORMATS = ['automate-agent-config'] as const;

/** The report formats the upload door reads. `sarif` covers most scanners. */
export const HEALTH_REPORT_FORMATS = [
  'sarif',
  ...HEALTH_METRIC_FORMATS,
  ...HEALTH_EVIDENCE_FORMATS,
  ...BUILT_IN_REPORT_FORMATS,
] as const;
export type HealthReportFormat = (typeof HEALTH_REPORT_FORMATS)[number];
export const HealthReportFormatSchema = z.enum(HEALTH_REPORT_FORMATS);

/** Whether the upload door accepts the format: every format but the built-in ones. */
export function isUploadReportFormat(format: HealthReportFormat): boolean {
  return !(BUILT_IN_REPORT_FORMATS as readonly string[]).includes(format);
}

/**
 * Formats whose findings enter the finding lifecycle: a finding the next report of the same
 * kind does not mention is `fixed`. Every other format carries no findings of its own.
 */
export const FINDING_REPORT_FORMATS = [
  'sarif',
  'cyclonedx-json',
  'stryker-mutation',
  'axe-json',
  'skillspector-json',
  'automate-agent-config',
] as const satisfies readonly HealthReportFormat[];
export type FindingReportFormat = (typeof FINDING_REPORT_FORMATS)[number];

export function isFindingReportFormat(format: HealthReportFormat): format is FindingReportFormat {
  return (FINDING_REPORT_FORMATS as readonly string[]).includes(format);
}

/** The inventory formats: a report of either is an SBOM the licence policy and supply-chain card read. */
export const SBOM_REPORT_FORMATS = [
  'cyclonedx-json',
  'spdx-json',
] as const satisfies readonly HealthReportFormat[];

/** A stored finding: what the scanner said, plus what people and later scans decided. */
export const HealthFindingSchema = CanonicalFindingSchema.extend({
  id: z.string().min(1),
  branch: z.string().min(1),
  /** The state that counts: an expired suppression or acceptance reads as `open`. */
  state: FindingStateSchema,
  triageReason: z.string().nullable(),
  triageExpiresAt: z.iso.datetime().nullable(),
  triagedBy: z.string().nullable(),
  owner: z.string().nullable(),
  firstSeenAt: z.iso.datetime(),
  lastSeenAt: z.iso.datetime(),
});
export type HealthFinding = z.infer<typeof HealthFindingSchema>;

export const HealthReportSummarySchema = z.object({
  id: z.string().min(1),
  format: HealthReportFormatSchema,
  source: HealthReportSourceSchema,
  toolKey: z.string().min(1),
  tools: z.array(HealthToolSchema).readonly(),
  commitSha: z.string().nullable(),
  findingCount: z.number().int().min(0),
  receivedAt: z.iso.datetime(),
});
export type HealthReportSummary = z.infer<typeof HealthReportSummarySchema>;

/** `GET /api/v1/projects/:id/health` */
export const ProjectHealthSchema = z.object({
  projectId: z.string().min(1),
  name: z.string().min(1),
  branch: z.string().min(1),
  evaluatedAt: z.iso.datetime(),
  grade: HealthGradeSchema,
  /** The reports the grade was computed from: the latest of each kind on the branch. */
  reports: z.array(HealthReportSummarySchema).readonly(),
});
export type ProjectHealth = z.infer<typeof ProjectHealthSchema>;

/** `GET /api/v1/projects/:id/health/findings` */
export const HealthFindingsPageSchema = z.object({
  findings: z.array(HealthFindingSchema).readonly(),
  total: z.number().int().min(0),
  offset: z.number().int().min(0),
  limit: z.number().int().min(1),
});
export type HealthFindingsPage = z.infer<typeof HealthFindingsPageSchema>;

export const HealthHistoryPointSchema = z.object({
  at: z.iso.datetime(),
  score: z.number().min(0).max(100).nullable(),
  letter: HealthLetterSchema.nullable(),
  dimensions: z.partialRecord(HealthDimensionSchema, z.number().min(0).max(100).nullable()),
});
export type HealthHistoryPoint = z.infer<typeof HealthHistoryPointSchema>;

/** `GET /api/v1/projects/:id/health/history` */
export const HealthHistorySchema = z.object({
  projectId: z.string().min(1),
  branch: z.string().min(1),
  points: z.array(HealthHistoryPointSchema).readonly(),
});
export type HealthHistory = z.infer<typeof HealthHistorySchema>;

export const PortfolioEntrySchema = z.object({
  projectId: z.string().min(1),
  name: z.string().min(1),
  slug: z.string().min(1),
  branch: z.string().min(1),
  /** `null` until a report has been received, or while the grade is incomplete. */
  score: z.number().min(0).max(100).nullable(),
  letter: HealthLetterSchema.nullable(),
  incomplete: z.boolean(),
  limiter: z.string().nullable(),
  /** The lowest-scoring measured dimension. */
  worst: HealthDimensionSchema.nullable(),
  /** Score now minus the score 30 days ago; `null` without both. */
  trend: z.number().nullable(),
  lastReportAt: z.iso.datetime().nullable(),
});
export type PortfolioEntry = z.infer<typeof PortfolioEntrySchema>;

/** `GET /api/v1/portfolio` */
export const PortfolioSchema = z.object({ projects: z.array(PortfolioEntrySchema).readonly() });
export type Portfolio = z.infer<typeof PortfolioSchema>;

/** `POST /api/v1/projects/:id/health/reports` */
export const HealthUploadResultSchema = z.object({
  reportId: z.string().min(1),
  branch: z.string().min(1),
  toolKey: z.string().min(1),
  findings: z.object({
    new: z.number().int().min(0),
    persisting: z.number().int().min(0),
    fixed: z.number().int().min(0),
  }),
  metrics: z.number().int().min(0),
  grade: HealthGradeSchema,
});
export type HealthUploadResult = z.infer<typeof HealthUploadResultSchema>;

/** `POST /api/v1/projects/:id/health/findings/:findingId/triage` */
export const TriageFindingBodySchema = z
  .object({
    state: z.enum(['open', 'suppressed', 'accepted', 'false_positive']),
    reason: z.string().trim().min(1).max(2000).optional(),
    expiresAt: z.iso.datetime().optional(),
    owner: z.string().trim().min(1).max(200).nullable().optional(),
  })
  .superRefine((body, ctx) => {
    // A person deciding a finding does not count leaves a reason; reopening needs none.
    if (body.state !== 'open' && body.reason === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['reason'],
        message: 'a triage decision needs a reason',
      });
    }
    // An accepted risk is a decision with a date on it, never a permanent one.
    if (body.state === 'accepted' && body.expiresAt === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['expiresAt'],
        message: 'an accepted risk needs an expiry',
      });
    }
  });
export type TriageFindingBody = z.infer<typeof TriageFindingBodySchema>;

/**
 * `POST /api/v1/projects/:id/health/scan` — one run, one job per scanner that applies.
 *
 * `notConfigured` names the scanners that apply to this repository but cannot run here, so
 * the dashboard says "Semgrep is not installed" rather than showing a clean Security score.
 */
export const HealthScanStartedSchema = z.object({
  runIds: z.array(z.string().min(1)),
  scanners: z.array(z.string().min(1)),
  notConfigured: z.array(z.string().min(1)),
});
export type HealthScanStarted = z.infer<typeof HealthScanStartedSchema>;

/**
 * A repository a runner may clone: `https://`, `ssh://`, or scp-style `git@host:owner/repo`.
 *
 * Refused, each for a reason git itself documents:
 * - `file:` and local paths — a clone of the runner's own disk;
 * - `ext::` and any other transport helper — runs an arbitrary command;
 * - credentials in the URL — they would be stored on the project row and printed in logs;
 *   a token belongs in the vault;
 * - a leading `-` — read by git as an option rather than a URL;
 * - whitespace or control characters — never part of a URL, often part of an injection.
 *
 * One schema, read by the API when a repository is registered and by the runner before it
 * clones, so the two cannot disagree about what is safe.
 */
/** Whitespace, a C0 control or DEL anywhere: by code point, so the rule needs no control-character regex. */
function hasControlOrSpace(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code <= 0x20 || code === 0x7f || /\s/u.test(character)) return true;
  }
  return false;
}

export const GitRepositoryUrlSchema = z
  .string()
  .min(1)
  .max(2000)
  .refine((url) => !hasControlOrSpace(url) && !url.startsWith('-'), {
    message: 'a repository URL has no whitespace, control characters or leading dash',
  })
  .refine(
    (url) => {
      const scp = /^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:(?!\/\/)[A-Za-z0-9._~/-]+$/u;
      if (scp.test(url)) return true;
      try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'ssh:') return false;
        if (parsed.hostname.length === 0) return false;
        // `ssh://git@host` names a user and no password; anything else is a credential.
        if (parsed.password.length > 0) return false;
        if (parsed.protocol === 'https:' && parsed.username.length > 0) return false;
        return parsed.pathname.length > 1;
      } catch {
        return false;
      }
    },
    {
      message:
        'only https://, ssh:// or git@host:owner/repo URLs without credentials can be cloned',
    },
  );
