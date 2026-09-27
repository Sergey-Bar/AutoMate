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

/**
 * The canonical event types, as named constants.
 *
 * Each was a bare literal in several places: five `z.literal('run:started')`-style
 * declarations spread across this package and `packages/realtime`, and bare strings
 * in the reporter adapters, the runner, and the API's own handlers. Adding an event
 * meant editing every one of them, and missing one produced an event that was valid
 * under its own writer's schema, valid under its own reader's schema, and silently
 * dropped by both — a dashboard that stops updating with no error anywhere.
 *
 * A string is invisible to a schema-name gate, which is why
 * `event-type-ownership.test.ts` exists alongside the one for schema names: it fails
 * if any of these is written as a literal outside this package. A consumer imports
 * the constant; a typo becomes a name that does not exist.
 *
 * **Each type is declared by its schema below, not duplicated here.** This block
 * owns the *strings*; the `z.literal` in each schema references them, so the value a
 * validator accepts and the value a writer emits cannot differ.
 */
export const RUN_STARTED_EVENT_TYPE = 'run:started' as const;
export const TEST_STARTED_EVENT_TYPE = 'test:started' as const;
export const TEST_COMPLETED_EVENT_TYPE = 'test:completed' as const;
export const RUN_COMPLETED_EVENT_TYPE = 'run:completed' as const;

/**
 * The two events only the server→browser stream carries.
 *
 * Declared here rather than in `realtime-events.ts` because the set of event *types*
 * is one thing and a reporter event is not a privileged kind: a reader matching on
 * `test:updated` needs the same protection against a typo as one matching on
 * `test:completed`, and a second set of constants in a second schema file is how the
 * second answer appeared in the first place. `realtime-events.ts` imports these.
 */
export const RUN_UPDATED_EVENT_TYPE = 'run:updated' as const;
export const TEST_UPDATED_EVENT_TYPE = 'test:updated' as const;

/** Every canonical event type, in one array, for a consumer that validates a union. */
export const EVENT_TYPES = [
  RUN_STARTED_EVENT_TYPE,
  TEST_STARTED_EVENT_TYPE,
  TEST_COMPLETED_EVENT_TYPE,
  RUN_COMPLETED_EVENT_TYPE,
  RUN_UPDATED_EVENT_TYPE,
  TEST_UPDATED_EVENT_TYPE,
] as const;

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
  type: z.literal(RUN_STARTED_EVENT_TYPE),
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
  type: z.literal(TEST_STARTED_EVENT_TYPE),
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
  type: z.literal(TEST_COMPLETED_EVENT_TYPE),
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
  type: z.literal(RUN_COMPLETED_EVENT_TYPE),
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
