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
