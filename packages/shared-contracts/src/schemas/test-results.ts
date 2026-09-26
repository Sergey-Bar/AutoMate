/**
 * Test results domain schemas — Zod v4
 *
 * Covers test run, suite, result, status, and attachment contracts
 * aligned with both the Automate and the Automate unified platform.
 */
import { z } from 'zod/v4';

// ---------------------------------------------------------------------------
// TestStatus / RunStatus
// ---------------------------------------------------------------------------

export const TestStatusSchema = z.enum([
  'passed',
  'failed',
  'flaky',
  'skipped',
  'timedOut',
  'running',
  'queued',
]);
export type TestStatus = z.infer<typeof TestStatusSchema>;

/**
 * The one run-status vocabulary.
 *
 * This was declared five times across three packages — the `runs.status` column,
 * `RunStatusSchema`, the API's `RunStatus` type, the dashboard's
 * `VALID_STATUSES`, and the reporter's upload schema — in **two** variants, one
 * with `queued` and one without. So `RunStatusSchema.safeParse('queued')`
 * succeeded while the `runs_status_check` constraint would have rejected the
 * value: the contract accepted a state the database refused.
 *
 * `shared-contracts` is the authority because it is the leaf every other package
 * depends on. `packages/db` cannot import it — it is itself a leaf, below the
 * contracts — so its column keeps a literal list, and
 * `run-status-vocabulary.test.ts` reads the real constraint and proves the
 * column's set is exactly this one minus `queued`. That is the only direction
 * that is safe: the column may hold less than the contract, never more.
 */
export const RUN_STATUS_VALUES = ['running', 'passed', 'failed', 'interrupted', 'queued'] as const;

/**
 * The statuses the `runs.status` column persists, which is
 * {@link RUN_STATUS_VALUES} without `queued`.
 *
 * `queued` is the column's *default* — a run row exists before it has started —
 * but the Drizzle enum never listed it, so the `runs_status_check` constraint
 * rejected a row written with the default. Kept here so the relationship is
 * declared once and the schema test can hold the two together.
 */
export const PERSISTED_RUN_STATUS_VALUES = RUN_STATUS_VALUES.filter(
  (status) => status !== 'queued',
) as readonly Exclude<(typeof RUN_STATUS_VALUES)[number], 'queued'>[];

export const RunStatusSchema = z.enum(RUN_STATUS_VALUES);
export type RunStatus = z.infer<typeof RunStatusSchema>;

// ---------------------------------------------------------------------------
// TestAttachment
// ---------------------------------------------------------------------------

export const TestAttachmentSchema = z.object({
  name: z.string(),
  contentType: z.string(),
  path: z.string().optional(),
  body: z.string().optional(),
});
export type TestAttachment = z.infer<typeof TestAttachmentSchema>;

// ---------------------------------------------------------------------------
// TestResult
// ---------------------------------------------------------------------------

export const TestResultSchema = z.object({
  id: z.string(),
  testId: z.string(),
  runId: z.string(),
  retry: z.number().int().min(0),
  status: TestStatusSchema,
  durationMs: z.number().optional(),
  startedAt: z.string().optional(),
  errorMessage: z.string().optional(),
  errorStack: z.string().optional(),
  attachments: z.array(TestAttachmentSchema).optional(),
});
export type TestResult = z.infer<typeof TestResultSchema>;

// ---------------------------------------------------------------------------
// TestSuite
// ---------------------------------------------------------------------------

export const TestSuiteSchema = z.object({
  id: z.string(),
  runId: z.string(),
  title: z.string(),
  file: z.string(),
  durationMs: z.number().optional(),
  total: z.number().int().min(0),
  passed: z.number().int().min(0),
  failed: z.number().int().min(0),
  skipped: z.number().int().min(0),
});
export type TestSuite = z.infer<typeof TestSuiteSchema>;

// ---------------------------------------------------------------------------
// TestRun
// ---------------------------------------------------------------------------

export const TestRunSchema = z.object({
  id: z.string(),
  status: RunStatusSchema,
  startedAt: z.string(),
  finishedAt: z.string().optional(),
  durationMs: z.number().optional(),
  total: z.number().int().min(0),
  passed: z.number().int().min(0),
  failed: z.number().int().min(0),
  flaky: z.number().int().min(0),
  skipped: z.number().int().min(0),
  branch: z.string().optional(),
  commitSha: z.string().optional(),
  triggeredBy: z.string().optional(),
});
export type TestRun = z.infer<typeof TestRunSchema>;
