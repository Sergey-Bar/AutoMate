import { z } from 'zod/v4';

/**
 * `POST /api/v1/projects/:id/tests/reports` — a CI job's test report, and the verdict on it.
 *
 * This is what `automate test` asks after the test command fails: is every failed test
 * quarantined? The server decides, from the report it parsed and the quarantine it holds,
 * so the CLI never reads a report and cannot read one differently from the gate.
 */
export const TEST_REPORT_FORMATS = ['junit', 'playwright-json'] as const;

export const TestReportQuerySchema = z.object({
  format: z.enum(TEST_REPORT_FORMATS),
  branch: z.string().trim().min(1).max(255).optional(),
  commit: z
    .string()
    .regex(/^[0-9a-f]{7,64}$/iu)
    .optional(),
  /** When the test command started, so a re-sent upload is the same run, not a conflict. */
  startedAt: z.iso.datetime().optional(),
});
export type TestReportQuery = z.infer<typeof TestReportQuerySchema>;

export const TestReportVerdictSchema = z.object({
  runId: z.string().min(1),
  /** `accepted` the first time, `duplicate` when the same report was sent again. */
  ingested: z.enum(['accepted', 'duplicate']),
  status: z.string().min(1),
  tests: z.object({
    total: z.number().int().min(0),
    passed: z.number().int().min(0),
    failed: z.number().int().min(0),
    flaky: z.number().int().min(0),
    skipped: z.number().int().min(0),
  }),
  /** Errors the producer reported outside any test. Any one makes the run unexcusable. */
  reportErrors: z.number().int().min(0),
  /** What the project's auto-quarantine policy did on this report (nothing unless `auto`). */
  autoQuarantine: z.object({ quarantined: z.array(z.string()), released: z.array(z.string()) }),
  quarantine: z.object({
    /**
     * True only when every failed test is an approved quarantine entry, at least one test
     * passed, and the report has no error outside its tests (`excusesRun` in the API).
     */
    excused: z.boolean(),
    excusedTests: z.array(z.string()),
    /** The failed tests no approved entry covers, by identity; at most 50. */
    unexcusedFailures: z.array(z.string()),
  }),
});
export type TestReportVerdict = z.infer<typeof TestReportVerdictSchema>;

/**
 * What a project does with a test the flake model flags.
 *
 * - `off` — nothing, not even a suggestion on the pull request.
 * - `suggest` — the default: the insights page and the comment name it; a person decides.
 * - `auto` — a test with evidence a code change cannot explain (a retry pass, or two outcomes
 *   on one commit; FLAKE-4) is quarantined and approved by `automate`, and released after
 *   `releaseAfter` clean passes in a row.
 */
export const QUARANTINE_MODES = ['off', 'suggest', 'auto'] as const;
export type QuarantineMode = (typeof QUARANTINE_MODES)[number];

/**
 * Twenty, because a test at the 20% flake threshold passes ten in a row 11% of the time
 * (0.8^10) and twenty in a row about 1% of the time (0.8^20): ten would release, and then
 * re-quarantine, a flaky test about one time in nine.
 */
export const DEFAULT_RELEASE_AFTER = 20;

export const QuarantinePolicySchema = z.object({
  mode: z.enum(QUARANTINE_MODES),
  releaseAfter: z.number().int().min(5).max(200),
});
export type QuarantinePolicy = z.infer<typeof QuarantinePolicySchema>;

export const DEFAULT_QUARANTINE_POLICY: QuarantinePolicy = {
  mode: 'suggest',
  releaseAfter: DEFAULT_RELEASE_AFTER,
};

/** One quarantined test of a project, with who owns it and what it has cost. */
export const ProjectQuarantineEntrySchema = z.object({
  id: z.string().min(1),
  testTitle: z.string().min(1),
  testFile: z.string(),
  stableId: z.string().nullable(),
  status: z.enum(['pending', 'approved', 'rejected', 'released']),
  quarantinedBy: z.string().min(1),
  reason: z.string().nullable(),
  quarantinedAt: z.string().min(1),
  releasedAt: z.string().nullable(),
  /** From the project's CODEOWNERS; `null` when it has none or no rule matches. */
  owner: z.string().nullable(),
  /** Whole days since the entry was created. */
  daysQuarantined: z.number().int().min(0),
  /** Over the cost window: retries spent, time they took, and runs the test blocked. */
  retriesSpent: z.number().int().min(0),
  wastedMs: z.number().int().min(0),
  blockedRuns: z.number().int().min(0),
  /** Clean passes in a row at the end of the window, toward `releaseAfter`. */
  cleanStreak: z.number().int().min(0),
});
export type ProjectQuarantineEntry = z.infer<typeof ProjectQuarantineEntrySchema>;

export const ProjectQuarantineSchema = z.object({
  policy: QuarantinePolicySchema,
  windowDays: z.number().int().min(1),
  entries: z.array(ProjectQuarantineEntrySchema),
});
export type ProjectQuarantine = z.infer<typeof ProjectQuarantineSchema>;

/**
 * `GET /api/v1/dashboard/tests/history?key=<identity>&days=&before=` — one test's results,
 * newest first, one page at a time from the `(workspace_id, stable_id)` index.
 *
 * The identity is a query parameter rather than a path segment because it is a file path:
 * it holds `/`, and a path segment would have to be encoded in a way every proxy agrees on.
 */
export const TestHistoryQuerySchema = z.object({
  key: z.string().min(1).max(2_000),
  days: z.coerce.number().int().min(1).max(365).default(90),
  limit: z.coerce.number().int().min(1).max(500).default(200),
  /** The `startedAt` of the last entry already read; the next page is older. */
  before: z.iso.datetime().optional(),
});
export type TestHistoryQuery = z.infer<typeof TestHistoryQuerySchema>;

export const TestHistoryEntrySchema = z.object({
  runId: z.string().min(1),
  startedAt: z.string().min(1),
  status: z.string().min(1),
  durationMs: z.number().nullable(),
  branch: z.string().nullable(),
  commitSha: z.string().nullable(),
  error: z.string().nullable(),
  /** `failureSignature` of the error, so recurrences of one cause group together. */
  signature: z.string().nullable(),
});
export type TestHistoryEntry = z.infer<typeof TestHistoryEntrySchema>;

export const TestHistorySchema = z.object({
  key: z.string().min(1),
  title: z.string().nullable(),
  file: z.string().nullable(),
  days: z.number().int().min(1),
  entries: z.array(TestHistoryEntrySchema),
  /** Older results exist in the window; ask again with `before` = the last `startedAt`. */
  nextBefore: z.string().nullable(),
  /** Distinct failure signatures in this page, most frequent first. */
  signatures: z.array(
    z.object({ signature: z.string(), count: z.number().int().min(1), example: z.string() }),
  ),
});
export type TestHistory = z.infer<typeof TestHistorySchema>;

/**
 * What a recurring failure is, decided once by a person and applied to every recurrence.
 * Keyed on `failureSignature` from `@automate/reporting`, the key insights clusters on.
 */
export const TRIAGE_CATEGORIES = ['product', 'test', 'environment', 'known-issue'] as const;
export type TriageCategory = (typeof TRIAGE_CATEGORIES)[number];

export const TriageLabelBodySchema = z
  .object({
    signature: z.string().min(1).max(4_000),
    category: z.enum(TRIAGE_CATEGORIES),
    issueUrl: z
      .url({ protocol: /^https?$/u })
      .max(2_000)
      .nullable()
      .optional(),
  })
  .strict();
export type TriageLabelBody = z.infer<typeof TriageLabelBodySchema>;

export const TriageLabelSchema = z.object({
  signature: z.string().min(1),
  category: z.enum(TRIAGE_CATEGORIES),
  issueUrl: z.string().nullable(),
  labelledAt: z.string().min(1),
  labelledBy: z.string().min(1),
});
export type TriageLabel = z.infer<typeof TriageLabelSchema>;
