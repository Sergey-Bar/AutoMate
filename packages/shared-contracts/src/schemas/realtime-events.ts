/**
 * Realtime events domain schemas — Zod v4
 *
 * Contracts for server→browser push events delivered over WebSocket.
 * All events carry an explicit `version` field for schema evolution.
 */
import { z } from 'zod/v4';
// The event *types* are owned by the reporter-event module, so there is one set of
// strings rather than a reporter set and a realtime set that can disagree.
import { RUN_UPDATED_EVENT_TYPE, TEST_UPDATED_EVENT_TYPE } from './reporter-events.js';

// ---------------------------------------------------------------------------
// Base RealtimeEvent
// ---------------------------------------------------------------------------

export const REALTIME_EVENT_VERSION = '1' as const;

export const RealtimeEventSchema = z.object({
  version: z.literal(REALTIME_EVENT_VERSION).default(REALTIME_EVENT_VERSION),
  type: z.string(),
  timestamp: z.string(),
});
export type RealtimeEvent = z.infer<typeof RealtimeEventSchema>;

// ---------------------------------------------------------------------------
// RunUpdated
// ---------------------------------------------------------------------------

export const RunUpdatedSchema = RealtimeEventSchema.extend({
  type: z.literal(RUN_UPDATED_EVENT_TYPE),
  payload: z.object({
    runId: z.string(),
    status: z.enum(['running', 'passed', 'failed', 'interrupted', 'queued']),
    total: z.number().int().min(0),
    passed: z.number().int().min(0),
    failed: z.number().int().min(0),
    flaky: z.number().int().min(0),
    skipped: z.number().int().min(0),
    durationMs: z.number().optional(),
  }),
});
export type RunUpdated = z.infer<typeof RunUpdatedSchema>;

// ---------------------------------------------------------------------------
// TestUpdated
// ---------------------------------------------------------------------------

export const TestUpdatedSchema = RealtimeEventSchema.extend({
  type: z.literal(TEST_UPDATED_EVENT_TYPE),
  payload: z.object({
    testId: z.string(),
    runId: z.string(),
    status: z.enum(['passed', 'failed', 'flaky', 'skipped', 'timedOut', 'running', 'queued']),
    durationMs: z.number().optional(),
    errorMessage: z.string().optional(),
  }),
});
export type TestUpdated = z.infer<typeof TestUpdatedSchema>;
