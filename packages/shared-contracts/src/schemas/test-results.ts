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

export const RunStatusSchema = z.enum(['running', 'passed', 'failed', 'interrupted', 'queued']);
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
