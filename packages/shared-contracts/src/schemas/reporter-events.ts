/**
 * Reporter events domain schemas — Zod v4
 *
 * Contracts for events emitted by the @automate/reporter
 * WebSocket reporter. All events carry an explicit `version` field
 * to support future schema evolution.
 */
import { z } from 'zod/v4';

// ---------------------------------------------------------------------------
// Base ReporterEvent
// ---------------------------------------------------------------------------

export const REPORTER_EVENT_VERSION = '1' as const;

export const ReporterEventSchema = z.object({
  version: z.literal(REPORTER_EVENT_VERSION).default(REPORTER_EVENT_VERSION),
  type: z.string(),
  runId: z.string(),
  timestamp: z.string(),
});
export type ReporterEvent = z.infer<typeof ReporterEventSchema>;

// ---------------------------------------------------------------------------
// RunStarted
// ---------------------------------------------------------------------------

export const RunStartedSchema = ReporterEventSchema.extend({
  type: z.literal('run:started'),
  payload: z.object({
    total: z.number().int().min(0),
    workers: z.number().int().min(1).optional(),
    branch: z.string().optional(),
    commitSha: z.string().optional(),
    triggeredBy: z.string().optional(),
  }),
});
export type RunStarted = z.infer<typeof RunStartedSchema>;

// ---------------------------------------------------------------------------
// TestStarted
// ---------------------------------------------------------------------------

export const TestStartedSchema = ReporterEventSchema.extend({
  type: z.literal('test:started'),
  payload: z.object({
    testId: z.string(),
    title: z.string(),
    file: z.string(),
    retry: z.number().int().min(0),
  }),
});
export type TestStarted = z.infer<typeof TestStartedSchema>;

// ---------------------------------------------------------------------------
// TestCompleted
// ---------------------------------------------------------------------------

export const TestCompletedSchema = ReporterEventSchema.extend({
  type: z.literal('test:completed'),
  payload: z.object({
    testId: z.string(),
    status: z.enum(['passed', 'failed', 'flaky', 'skipped', 'timedOut']),
    durationMs: z.number().optional(),
    retry: z.number().int().min(0),
    errorMessage: z.string().optional(),
  }),
});
export type TestCompleted = z.infer<typeof TestCompletedSchema>;

// ---------------------------------------------------------------------------
// RunCompleted
// ---------------------------------------------------------------------------

export const RunCompletedSchema = ReporterEventSchema.extend({
  type: z.literal('run:completed'),
  payload: z.object({
    status: z.enum(['passed', 'failed', 'interrupted']),
    total: z.number().int().min(0),
    passed: z.number().int().min(0),
    failed: z.number().int().min(0),
    flaky: z.number().int().min(0),
    skipped: z.number().int().min(0),
    durationMs: z.number().optional(),
  }),
});
export type RunCompleted = z.infer<typeof RunCompletedSchema>;
