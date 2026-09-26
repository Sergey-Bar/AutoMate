/**
 * events.ts
 *
 * Typed event definitions for the browser broadcast layer.
 *
 * These are the **flat** event shapes: a `type`, a `version`, and the fields the
 * dashboard reads directly, with no envelope and no `payload`. They are named
 * `Flat*` on purpose.
 *
 * They used to be called `ReporterEventSchema` and `RealtimeEventSchema`, which
 * is the same name `@automate/shared-contracts` exports for a *different* shape
 * — an envelope with `contractVersion`/`eventId`/`occurredAt` and a `data`
 * payload, with dot-separated event types. Two validators, one bare name, no
 * compile-time signal: an import of the wrong one failed at runtime with a Zod
 * error on a message that was valid under the other. Nothing consumed these
 * outside this file's own test, so renaming costs nothing and removes the trap.
 *
 * `@automate/shared-contracts` is the single authority for the versioned reporter
 * contract. `ReporterContractEventSchema` below is a deliberate re-export of it,
 * not a second declaration.
 */
import { z } from 'zod/v4';
import {
  ReporterEventSchema as ContractReporterEventSchema,
  RunEventEnvelopeSchema,
  type RunEventEnvelope,
} from '@automate/shared-contracts';

export { RunEventEnvelopeSchema } from '@automate/shared-contracts';
export type { RunEventEnvelope };
export type RunEvent = RunEventEnvelope;
export const CanonicalRunEventSchema = RunEventEnvelopeSchema;

/**
 * The versioned reporter contract, re-exported under an explicit name.
 *
 * This is the *same object* the contract exports, not a copy — which is the
 * point of the rename: a consumer reaching for the reporter event contract
 * cannot now reach a flat broadcast schema by accident.
 */
export const ReporterContractEventSchema = ContractReporterEventSchema;
export type ReporterContractEvent = z.infer<typeof ContractReporterEventSchema>;

// ---------------------------------------------------------------------------
// Individual broadcast event schemas (flat, dashboard-facing)
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

/** Reporter events in the *flat* broadcast shape. */
export const FlatReporterEventSchema = z.discriminatedUnion('type', [
  RunStartedEventSchema,
  RunCompletedEventSchema,
  TestCompletedEventSchema,
]);

/** Events broadcast to browser dashboard clients. */
export const FlatRealtimeEventSchema = z.discriminatedUnion('type', [
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
export type FlatReporterEvent = z.infer<typeof FlatReporterEventSchema>;
export type FlatRealtimeEvent = z.infer<typeof FlatRealtimeEventSchema>;
