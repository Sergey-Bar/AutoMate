/**
 * events.ts
 *
 * Typed WebSocket event definitions for the Automate realtime layer.
 *
 * All events carry an explicit `version: '1'` literal so consumers can
 * detect schema mismatches at runtime and during migration.
 *
 * Two discriminated unions are exported:
 *  - `ReporterEventSchema`  — events emitted by the Playwright reporter
 *  - `RealtimeEventSchema`  — events broadcast to browser clients
 */
import { z } from 'zod/v4';
import { RunEventEnvelopeSchema, type RunEventEnvelope } from '@automate/shared-contracts';

export { RunEventEnvelopeSchema } from '@automate/shared-contracts';
export type { RunEventEnvelope };
export type RunEvent = RunEventEnvelope;
export const CanonicalRunEventSchema = RunEventEnvelopeSchema;

// ---------------------------------------------------------------------------
// Individual event schemas
// ---------------------------------------------------------------------------

export const RunStartedEventSchema = z.object({
  type: z.literal('run:started'),
  version: z.literal('1'),
  runId: z.string(),
  projectName: z.string(),
  startedAt: z.string(),
});

export const RunCompletedEventSchema = z.object({
  type: z.literal('run:completed'),
  version: z.literal('1'),
  runId: z.string(),
  status: z.string(),
  total: z.number(),
  passed: z.number(),
  failed: z.number(),
  duration: z.number(),
});

/** Live status update — broadcast while a run is in progress */
export const RunUpdatedEventSchema = z.object({
  type: z.literal('run:updated'),
  version: z.literal('1'),
  runId: z.string(),
  status: z.string(),
  timestamp: z.string(),
});

export const TestCompletedEventSchema = z.object({
  type: z.literal('test:completed'),
  version: z.literal('1'),
  runId: z.string(),
  testId: z.string(),
  title: z.string(),
  status: z.string(),
  duration: z.number(),
});

export const AIToolEventSchema = z.object({
  type: z.literal('ai:tool'),
  version: z.literal('1'),
  conversationId: z.string(),
  toolName: z.string(),
  status: z.string(),
  timestamp: z.string(),
});

// ---------------------------------------------------------------------------
// Discriminated unions
// ---------------------------------------------------------------------------

/** Events produced by the Playwright WebSocket reporter */
export const ReporterEventSchema = z.discriminatedUnion('type', [
  RunStartedEventSchema,
  RunCompletedEventSchema,
  TestCompletedEventSchema,
]);

/** Events broadcast to browser dashboard clients */
export const RealtimeEventSchema = z.discriminatedUnion('type', [
  RunUpdatedEventSchema,
  TestCompletedEventSchema,
  AIToolEventSchema,
]);

// ---------------------------------------------------------------------------
// TypeScript types (inferred — never handwritten)
// ---------------------------------------------------------------------------

export type RunStartedEvent = z.infer<typeof RunStartedEventSchema>;
export type RunCompletedEvent = z.infer<typeof RunCompletedEventSchema>;
export type RunUpdatedEvent = z.infer<typeof RunUpdatedEventSchema>;
export type TestCompletedEvent = z.infer<typeof TestCompletedEventSchema>;
export type AIToolEvent = z.infer<typeof AIToolEventSchema>;
export type ReporterEvent = z.infer<typeof ReporterEventSchema>;
export type RealtimeEvent = z.infer<typeof RealtimeEventSchema>;
