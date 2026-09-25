import { z } from 'zod/v4';
import {
  QA_CONTRACT_VERSION,
  RunEventEnvelopeSchema,
  RunSummarySchema,
  type CanonicalTestStatus,
  type KnownRunOutcome,
  type RunEventEnvelope,
  type RunPhase,
  type RunSummary,
} from './execution.js';

const LegacyReporterEventInputSchema = z
  .object({
    type: z.enum(['run:start', 'test:begin', 'test:end', 'run:end']),
    runId: z.string().min(1),
    version: z.literal('1').optional(),
    contractVersion: z.literal('1').optional(),
    timestamp: z
      .string()
      .refine((value) => !Number.isNaN(Date.parse(value)))
      .optional(),
    occurredAt: z
      .string()
      .refine((value) => !Number.isNaN(Date.parse(value)))
      .optional(),
    eventId: z.string().min(1).optional(),
    payload: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();
export type LegacyReporterEventInput = z.infer<typeof LegacyReporterEventInputSchema>;

export const LegacyReporterAdapterContextSchema = z.object({
  runId: z.string().min(1),
  sequence: z.number().int().min(1),
  eventId: z.string().min(1).optional(),
  occurredAt: z
    .string()
    .refine((value) => !Number.isNaN(Date.parse(value)))
    .optional(),
});
export type LegacyReporterAdapterContext = z.infer<typeof LegacyReporterAdapterContextSchema>;

const TEST_STATUSES = {
  queued: 'queued',
  running: 'running',
  passed: 'passed',
  success: 'passed',
  ok: 'passed',
  failed: 'failed',
  failure: 'failed',
  error: 'failed',
  flaky: 'flaky',
  skipped: 'skipped',
  blocked: 'blocked',
  unknown: 'unknown',
  cancelled: 'cancelled',
  canceled: 'cancelled',
  timedOut: 'timed_out',
  timed_out: 'timed_out',
} satisfies Record<string, CanonicalTestStatus>;

const RUN_OUTCOMES = {
  passed: 'passed',
  success: 'passed',
  ok: 'passed',
  failed: 'failed',
  failure: 'failed',
  error: 'failed',
  unknown: 'unknown',
  partial: 'partial',
  cancelled: 'cancelled',
  canceled: 'cancelled',
  interrupted: 'cancelled',
  timedOut: 'timed_out',
  timed_out: 'timed_out',
  runner_lost: 'runner_lost',
  infra_failed: 'infra_failed',
  config_failed: 'config_failed',
  blocked: 'blocked',
} satisfies Record<string, KnownRunOutcome>;

const TERMINAL_PHASES = {
  passed: 'complete',
  failed: 'complete',
  unknown: 'complete',
  partial: 'partial',
  cancelled: 'cancelled',
  canceled: 'cancelled',
  interrupted: 'cancelled',
  timedOut: 'timed_out',
  timed_out: 'timed_out',
  runner_lost: 'runner_lost',
  infra_failed: 'infra_failed',
  config_failed: 'config_failed',
  blocked: 'blocked',
} satisfies Record<string, RunPhase>;

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function mergePayload(event: LegacyReporterEventInput): Record<string, unknown> {
  const {
    type: _type,
    runId: _runId,
    version: _version,
    contractVersion: _contractVersion,
    timestamp: _timestamp,
    occurredAt: _occurredAt,
    eventId: _eventId,
    payload,
    ...flatPayload
  } = event;
  return { ...flatPayload, ...asRecord(payload) };
}

function firstString(payload: Record<string, unknown>, keys: string[]): string | undefined {
  const value = keys.map((key) => payload[key]).find((candidate) => typeof candidate === 'string');
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function firstNumber(payload: Record<string, unknown>, keys: string[]): number | undefined {
  const value = keys
    .map((key) => payload[key])
    .find((candidate) => typeof candidate === 'number' && Number.isFinite(candidate));
  return typeof value === 'number' ? value : undefined;
}

function stringArray(payload: Record<string, unknown>, key: string): string[] {
  const value = payload[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function eventTimestamp(
  event: LegacyReporterEventInput,
  payload: Record<string, unknown>,
  context: LegacyReporterAdapterContext,
): string {
  return (
    context.occurredAt ??
    event.occurredAt ??
    event.timestamp ??
    firstString(payload, ['occurredAt', 'timestamp']) ??
    new Date().toISOString()
  );
}

function attemptNumber(payload: Record<string, unknown>): number {
  const attempt = firstNumber(payload, ['attempt']);
  if (attempt !== undefined) {
    return Math.max(1, Math.trunc(attempt));
  }
  const retry = firstNumber(payload, ['retry']);
  return retry === undefined ? 1 : Math.max(1, Math.trunc(retry) + 1);
}

function errorFrom(
  payload: Record<string, unknown>,
): { code: string; message: string } | undefined {
  const nested = asRecord(payload.error);
  const message =
    firstString(payload, ['errorMessage', 'message']) ?? firstString(nested, ['message']);
  if (message === undefined) {
    return undefined;
  }
  return {
    code: firstString(nested, ['code']) ?? 'legacy_error',
    message,
  };
}

function summaryFrom(payload: Record<string, unknown>): RunSummary | undefined {
  const summaryPayload = asRecord(payload.summary);
  const total = firstNumber(summaryPayload, ['total']) ?? firstNumber(payload, ['total']);
  if (total === undefined) {
    return undefined;
  }
  return RunSummarySchema.parse({
    total,
    passed: firstNumber(summaryPayload, ['passed']) ?? firstNumber(payload, ['passed']) ?? 0,
    failed: firstNumber(summaryPayload, ['failed']) ?? firstNumber(payload, ['failed']) ?? 0,
    flaky: firstNumber(summaryPayload, ['flaky']) ?? firstNumber(payload, ['flaky']) ?? 0,
    skipped: firstNumber(summaryPayload, ['skipped']) ?? firstNumber(payload, ['skipped']) ?? 0,
    unknown: firstNumber(summaryPayload, ['unknown']) ?? firstNumber(payload, ['unknown']) ?? 0,
    durationMs:
      firstNumber(summaryPayload, ['durationMs']) ??
      firstNumber(payload, ['durationMs', 'duration']) ??
      null,
  });
}

function testIdFrom(payload: Record<string, unknown>): string {
  const testId = firstString(payload, ['testId', 'test_id', 'id']);
  if (testId === undefined) {
    throw new Error('Legacy test event requires testId');
  }
  return testId;
}

function deterministicEventId(
  type: LegacyReporterEventInput['type'],
  externalRunId: string,
  testId?: string,
  attempt?: number,
): string {
  return ['legacy', type, externalRunId, testId ?? '', attempt ?? '']
    .map((part) => encodeURIComponent(part))
    .join(':');
}

function normalizeTestStatus(value: unknown): CanonicalTestStatus {
  return typeof value === 'string'
    ? (TEST_STATUSES[value as keyof typeof TEST_STATUSES] ?? 'unknown')
    : 'unknown';
}

function normalizeRunOutcome(payload: Record<string, unknown>): KnownRunOutcome {
  const result = asRecord(payload.result);
  const status =
    firstString(payload, ['outcome', 'status']) ?? firstString(result, ['outcome', 'status']);
  return typeof status === 'string'
    ? (RUN_OUTCOMES[status as keyof typeof RUN_OUTCOMES] ?? 'unknown')
    : 'unknown';
}

function normalizeRunPhase(outcome: KnownRunOutcome): RunPhase {
  return TERMINAL_PHASES[outcome];
}

export function legacyReporterAdapter(
  input: unknown,
  contextInput: LegacyReporterAdapterContext,
): RunEventEnvelope {
  const event = LegacyReporterEventInputSchema.parse(input);
  const context = LegacyReporterAdapterContextSchema.parse(contextInput);
  const payload = mergePayload(event);
  const occurredAt = eventTimestamp(event, payload, context);
  const base = {
    version: QA_CONTRACT_VERSION,
    eventId: '',
    sequence: context.sequence,
    occurredAt,
    runId: context.runId,
  };

  if (event.type === 'run:start') {
    return RunEventEnvelopeSchema.parse({
      ...base,
      eventId: context.eventId ?? event.eventId ?? deterministicEventId(event.type, event.runId),
      type: 'run.started',
      payload: {
        externalId: event.runId,
        phase: 'running',
        outcome: null,
        startedAt: occurredAt,
        branch: firstString(payload, ['branch', 'ref']),
        commit: firstString(payload, ['commit', 'commitSha']),
        total: firstNumber(payload, ['total', 'testsTotal']),
      },
    });
  }

  if (event.type === 'test:begin') {
    const testId = testIdFrom(payload);
    const attempt = attemptNumber(payload);
    return RunEventEnvelopeSchema.parse({
      ...base,
      eventId:
        context.eventId ??
        event.eventId ??
        deterministicEventId(event.type, event.runId, testId, attempt),
      type: 'test.started',
      payload: {
        testId,
        attempt,
        status: 'running',
        title: firstString(payload, ['title', 'name']) ?? testId,
        suite: firstString(payload, ['suite']),
        file: firstString(payload, ['file', 'fileName', 'specPath', 'path']),
        startedAt: occurredAt,
      },
    });
  }

  if (event.type === 'test:end') {
    const testId = testIdFrom(payload);
    const attempt = attemptNumber(payload);
    return RunEventEnvelopeSchema.parse({
      ...base,
      eventId:
        context.eventId ??
        event.eventId ??
        deterministicEventId(event.type, event.runId, testId, attempt),
      type: 'test.completed',
      payload: {
        testId,
        attempt,
        status: normalizeTestStatus(firstString(payload, ['status', 'result'])),
        title: firstString(payload, ['title', 'name']),
        suite: firstString(payload, ['suite']),
        file: firstString(payload, ['file', 'fileName', 'specPath', 'path']),
        finishedAt: occurredAt,
        durationMs: firstNumber(payload, ['durationMs', 'duration']),
        error: errorFrom(payload),
        artifactIds: stringArray(payload, 'artifactIds'),
      },
    });
  }

  const outcome = normalizeRunOutcome(payload);
  return RunEventEnvelopeSchema.parse({
    ...base,
    eventId: context.eventId ?? event.eventId ?? deterministicEventId(event.type, event.runId),
    type: 'run.completed',
    payload: {
      phase: normalizeRunPhase(outcome),
      outcome,
      finishedAt: occurredAt,
      summary: summaryFrom(payload),
      error: errorFrom(payload),
      artifactIds: stringArray(payload, 'artifactIds'),
    },
  });
}
