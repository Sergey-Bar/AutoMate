import { z } from 'zod/v4';
import { EVAL_UPLOAD_FORMATS } from './health.js';
import { ScorecardSchema } from './scorecard.js';

// ─── Agent quality: evals, traces, runtime, agent configuration ──────────────
//
// Every eval run, case and span here is workspace-scoped and project-scoped on the server. A
// prompt is present only when the project's policy says `agents.storePrompts`; span content
// is never part of any response here — the runtime analytics read counts, durations and
// statuses, and nothing else.

const IntervalSchema = z.object({ estimate: z.number(), low: z.number(), high: z.number() });

const EvalToolSchema = z.object({
  name: z.string().min(1).max(100),
  version: z.string().max(100).nullable(),
});

export const EvalScoreSchema = z.object({
  metric: z.string().min(1).max(100),
  score: z.number().nullable(),
  threshold: z.number().nullable(),
  passed: z.boolean().nullable(),
});

export const EvalAttemptSchema = z.object({
  epoch: z.number().int().min(0),
  passed: z.boolean().nullable(),
  error: z.string().max(2000).nullable(),
  scores: z.array(EvalScoreSchema).max(50),
  latencyMs: z.number().min(0).nullable(),
  tokensInput: z.number().min(0).nullable(),
  tokensOutput: z.number().min(0).nullable(),
  costUsd: z.number().min(0).nullable(),
});
export type EvalAttemptRecord = z.infer<typeof EvalAttemptSchema>;

export const EvalCaseSchema = z.object({
  caseId: z.string().min(1).max(500),
  label: z.string().max(500),
  promptHash: z.string().max(100).nullable(),
  /** Present only when the project's policy keeps prompts. */
  prompt: z.string().max(20_000).nullable(),
  attempts: z.array(EvalAttemptSchema).max(1000),
});
export type EvalCaseRecord = z.infer<typeof EvalCaseSchema>;

export const EvalTotalsSchema = z.object({
  cases: z.number().int().min(0),
  attempts: z.number().int().min(0),
  passed: z.number().int().min(0),
  failed: z.number().int().min(0),
  errors: z.number().int().min(0),
  tokensInput: z.number().min(0).nullable(),
  tokensOutput: z.number().min(0).nullable(),
  costUsd: z.number().min(0).nullable(),
  meanLatencyMs: z.number().min(0).nullable(),
});

/**
 * `automate-eval-json`: Automate's own eval run shape — the one `parseEvalReport` produces for
 * the three tools, written as a document. The built-in eval runner uploads its runs in it, and
 * any CI job may too.
 */
export const AutomateEvalRunSchema = z.object({
  tool: EvalToolSchema,
  suite: z.string().min(1).max(200),
  model: z.string().max(200).nullable(),
  provider: z.string().max(100).nullable(),
  configHash: z.string().min(1).max(100),
  cases: z.array(EvalCaseSchema).max(20_000),
  totals: EvalTotalsSchema,
  truncated: z.boolean(),
});
export type AutomateEvalRun = z.infer<typeof AutomateEvalRunSchema>;

export const EvalRunSourceSchema = z.enum(['ci', 'runner', 'manual']);

export const EvalRunSummarySchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  branch: z.string().min(1),
  commitSha: z.string().nullable(),
  suite: z.string().min(1),
  format: z.enum(EVAL_UPLOAD_FORMATS),
  source: EvalRunSourceSchema,
  tool: EvalToolSchema,
  model: z.string().nullable(),
  provider: z.string().nullable(),
  configHash: z.string(),
  totals: EvalTotalsSchema,
  /** The report had more cases than were kept, or a case more attempts. */
  truncated: z.boolean(),
  receivedAt: z.iso.datetime(),
});
export type EvalRunSummary = z.infer<typeof EvalRunSummarySchema>;

/** `GET /api/v1/projects/:id/evals/runs/:runId` */
export const EvalRunDetailSchema = EvalRunSummarySchema.extend({
  cases: z.array(EvalCaseSchema),
});
export type EvalRunDetail = z.infer<typeof EvalRunDetailSchema>;

const EvalCaseChangeSchema = z.object({
  caseId: z.string(),
  baselinePassRate: z.number().min(0).max(1),
  candidatePassRate: z.number().min(0).max(1),
  significant: z.boolean(),
});

export const EvalComparisonSchema = z.object({
  verdict: z.enum(['pass', 'fail', 'insufficient']),
  overall: z.object({
    baseline: IntervalSchema.nullable(),
    candidate: IntervalSchema.nullable(),
    change: z.enum(['higher', 'lower', 'same']).nullable(),
  }),
  regressions: z.array(EvalCaseChangeSchema),
  improvements: z.array(EvalCaseChangeSchema),
  newCases: z.array(z.string()),
  removedCases: z.array(z.string()),
  flaky: z.array(z.string()),
  metricChanges: z.array(
    z.object({
      metric: z.string(),
      difference: IntervalSchema.nullable(),
      significant: z.boolean(),
    }),
  ),
  reasons: z.array(z.string()),
});
export type EvalComparisonRecord = z.infer<typeof EvalComparisonSchema>;

export const EvalSuiteStatusSchema = z.object({
  suite: z.string().min(1),
  /** The newest run of the suite on the branch asked about. */
  latest: EvalRunSummarySchema,
  /** The newest run of the suite on the default branch; `null` on it or when there is none. */
  baseline: EvalRunSummarySchema.nullable(),
  /** `null` when there is no baseline, or the branch is the default branch. */
  comparison: EvalComparisonSchema.nullable(),
  scorecard: ScorecardSchema,
});
export type EvalSuiteStatus = z.infer<typeof EvalSuiteStatusSchema>;

/** `GET /api/v1/projects/:id/evals?branch=` */
export const ProjectEvalsSchema = z.object({
  projectId: z.string().min(1),
  branch: z.string().min(1),
  defaultBranch: z.string().min(1),
  evaluatedAt: z.iso.datetime(),
  suites: z.array(EvalSuiteStatusSchema),
  /** The latest runs on the branch, newest first. */
  runs: z.array(EvalRunSummarySchema),
});
export type ProjectEvals = z.infer<typeof ProjectEvalsSchema>;

// ─── OTLP traces ─────────────────────────────────────────────────────────────

/** The OTLP/HTTP `ExportTraceServiceResponse`, in its JSON encoding. */
export const OtlpExportResponseSchema = z.object({
  partialSuccess: z.object({
    rejectedSpans: z.number().int().min(0),
    errorMessage: z.string(),
  }),
});
export type OtlpExportResponse = z.infer<typeof OtlpExportResponseSchema>;

// ─── Agent runtime ───────────────────────────────────────────────────────────

const RuntimeStatsSchema = z.object({
  runs: z.number().int().min(0),
  inputTokens: z.number().min(0),
  outputTokens: z.number().min(0),
  cost: z.object({
    knownUsd: z.number().min(0),
    unknownSpans: z.number().int().min(0),
    pricedSpans: z.number().int().min(0),
  }),
  costPerRunUsd: z.number().nullable(),
  tokensPerRun: z.number().nullable(),
  latency: z.object({ p50Ms: z.number().nullable(), p95Ms: z.number().nullable() }),
  errors: z.object({ failed: z.number().int().min(0), rate: IntervalSchema.nullable() }),
  toolCalls: z.object({
    total: z.number().int().min(0),
    failed: z.number().int().min(0),
    rate: IntervalSchema.nullable(),
    topFailingTool: z.object({ name: z.string(), failures: z.number().int() }).nullable(),
  }),
  meanTrajectoryLength: z.number().nullable(),
  loops: z.number().int().min(0),
});

const RuntimeRowSchema = z.object({
  key: z.string(),
  current: RuntimeStatsSchema,
  previous: RuntimeStatsSchema.nullable(),
  change: z
    .object({
      runs: z.number(),
      costPerRunUsd: z.number().nullable(),
      tokensPerRun: z.number().nullable(),
      p95LatencyMs: z.number().nullable(),
      errorRate: z.number().nullable(),
      toolFailureRate: z.number().nullable(),
    })
    .nullable(),
});

export const AgentRuntimeResultSchema = z.object({
  window: z.object({ from: z.string(), to: z.string(), days: z.number().int().min(1) }),
  previous: z.boolean(),
  overall: RuntimeRowSchema,
  agents: z.array(RuntimeRowSchema),
  models: z.array(RuntimeRowSchema),
  loops: z.array(
    z.object({
      traceId: z.string(),
      runSpanId: z.string().nullable(),
      agent: z.string(),
      toolName: z.string(),
      toolArgsHash: z.string(),
      count: z.number().int().min(1),
      spanIds: z.array(z.string()),
    }),
  ),
  outsideWindow: z.number().int().min(0),
});

/** `GET /api/v1/projects/:id/agents/runtime?days=` and `GET /api/v1/chat/runtime?days=` */
export const AgentRuntimeReportSchema = z.object({
  /** `null` for the installation's own chat telemetry. */
  projectId: z.string().nullable(),
  days: z.number().int().min(1),
  evaluatedAt: z.iso.datetime(),
  /** More spans were in the window than were read; the analytics describe the newest. */
  truncated: z.boolean(),
  runtime: AgentRuntimeResultSchema,
  scorecard: ScorecardSchema,
});
export type AgentRuntimeReport = z.infer<typeof AgentRuntimeReportSchema>;

// ─── Agent configuration and the MCP inventory ───────────────────────────────

export const MAX_AGENT_CONFIG_FILES = 200;
export const MAX_AGENT_CONFIG_FILE_BYTES = 256 * 1024;

/** `POST /api/v1/projects/:id/health/agent-config`: CI sends the files the server cannot read. */
export const AgentConfigUploadBodySchema = z.object({
  branch: z.string().trim().min(1).max(255),
  commit: z
    .string()
    .regex(/^[0-9a-f]{7,64}$/iu)
    .optional(),
  files: z
    .array(
      z.object({
        path: z.string().min(1).max(1000),
        text: z.string().max(MAX_AGENT_CONFIG_FILE_BYTES),
      }),
    )
    .max(MAX_AGENT_CONFIG_FILES),
});
export type AgentConfigUploadBody = z.infer<typeof AgentConfigUploadBodySchema>;

export const AgentConfigScanResultSchema = z.object({
  branch: z.string().min(1),
  filesScanned: z.number().int().min(0),
  /** Files sent or found that are not agent configuration, and so were not read. */
  ignored: z.number().int().min(0),
  findings: z.object({
    new: z.number().int().min(0),
    persisting: z.number().int().min(0),
    fixed: z.number().int().min(0),
  }),
  mcpServers: z.number().int().min(0),
});
export type AgentConfigScanResult = z.infer<typeof AgentConfigScanResultSchema>;

export const McpServerSchema = z.object({
  name: z.string(),
  configPath: z.string(),
  transport: z.enum(['stdio', 'http', 'sse', 'unknown']),
  command: z.string().nullable(),
  package: z.string().nullable(),
  version: z.string().nullable(),
  pinned: z.boolean(),
  url: z.string().nullable(),
  /** The names of the environment variables it is given. Never a value. */
  envKeys: z.array(z.string()),
  commitSha: z.string().nullable(),
  scannedAt: z.iso.datetime(),
});

/** `GET /api/v1/projects/:id/agents/mcp-servers?branch=` */
export const McpServerListSchema = z.object({
  projectId: z.string().min(1),
  branch: z.string().min(1),
  servers: z.array(McpServerSchema),
});
export type McpServerList = z.infer<typeof McpServerListSchema>;

// ─── The built-in eval runner ────────────────────────────────────────────────

/** The longest regex pattern a dataset check may carry. */
export const MAX_EVAL_REGEX_CHARS = 200;

export const EvalCheckSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('contains'),
    value: z.string().min(1).max(2000),
    caseSensitive: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('regex'),
    pattern: z.string().min(1).max(MAX_EVAL_REGEX_CHARS),
    flags: z
      .string()
      .regex(/^[imsu]{0,4}$/u)
      .optional(),
  }),
  z.object({
    type: z.literal('json'),
    /** Keys the output, parsed as a JSON object, must have, each with this JSON type. */
    required: z
      .array(
        z.object({
          key: z.string().min(1).max(200),
          type: z.enum(['string', 'number', 'boolean', 'object', 'array', 'null']),
        }),
      )
      .max(50),
  }),
]);
export type EvalCheck = z.infer<typeof EvalCheckSchema>;

export const EvalDatasetCaseSchema = z.object({
  id: z.string().trim().min(1).max(200),
  input: z.string().min(1).max(32_000),
  system: z.string().max(32_000).optional(),
  checks: z.array(EvalCheckSchema).min(1).max(20),
});
export type EvalDatasetCase = z.infer<typeof EvalDatasetCaseSchema>;

/** `POST /api/v1/projects/:id/evals/datasets`: create, or replace by name. */
export const EvalDatasetBodySchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .regex(/^[A-Za-z0-9][A-Za-z0-9 ._:/-]*$/u),
  model: z.string().trim().min(1).max(200),
  /** Attempts per case. The comparison needs repeats to tell noise from a regression. */
  repeats: z.number().int().min(1).max(20).default(3),
  /** An LLM judge, off unless configured: the case also passes only when the judge says so. */
  judge: z
    .object({
      model: z.string().trim().min(1).max(200),
      rubric: z.string().min(1).max(4000),
    })
    .optional(),
  cases: z.array(EvalDatasetCaseSchema).min(1).max(200),
});
export type EvalDatasetBody = z.infer<typeof EvalDatasetBodySchema>;

export const EvalDatasetSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  name: z.string(),
  model: z.string(),
  repeats: z.number().int(),
  judge: z.object({ model: z.string(), rubric: z.string() }).nullable(),
  cases: z.array(EvalDatasetCaseSchema),
  updatedAt: z.iso.datetime(),
});
export type EvalDataset = z.infer<typeof EvalDatasetSchema>;

export const EvalDatasetListSchema = z.object({
  projectId: z.string().min(1),
  datasets: z.array(EvalDatasetSchema),
});

/** `POST /api/v1/projects/:id/evals/datasets/:datasetId/run` */
export const EvalDatasetRunBodySchema = z.object({
  branch: z.string().trim().min(1).max(255).optional(),
  commit: z
    .string()
    .regex(/^[0-9a-f]{7,64}$/iu)
    .optional(),
});

export const EvalDatasetRunStartedSchema = z.object({
  datasetId: z.string().min(1),
  suite: z.string().min(1),
  branch: z.string().min(1),
  attempts: z.number().int().min(1),
  status: z.literal('started'),
});
export type EvalDatasetRunStarted = z.infer<typeof EvalDatasetRunStartedSchema>;
