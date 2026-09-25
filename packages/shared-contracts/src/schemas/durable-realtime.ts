import { z } from 'zod/v4';
import { RunEventTypeSchema } from './execution.js';

export const DURABLE_OUTBOX_EVENT_TYPES = [
  ...RunEventTypeSchema.options,
  'execution.run.created',
  'execution.run.cancelled',
  'execution.event.appended',
  'execution.job.completed',
  'run:updated',
  'run.updated',
] as const;

export const DURABLE_SSE_EVENT_TYPES = [...RunEventTypeSchema.options, 'refetch'] as const;
export const DURABLE_SSE_COMPATIBILITY_EVENT = 'message' as const;

export const DurableOutboxEventTypeSchema = z.string().min(1);
export const DurableSseEventTypeSchema = z.enum(DURABLE_SSE_EVENT_TYPES);

export type DurableOutboxEventType = z.infer<typeof DurableOutboxEventTypeSchema>;
export type DurableSseEventType =
  | z.infer<typeof DurableSseEventTypeSchema>
  | typeof DURABLE_SSE_COMPATIBILITY_EVENT;

export const DurableSseRecordSchema = z.object({
  sequence: z.number().int().positive(),
  eventId: z.string().min(1),
  eventVersion: z.number().int().positive().default(1),
  eventType: DurableOutboxEventTypeSchema,
  occurredAt: z.coerce.date(),
  payload: z.record(z.string(), z.unknown()),
});

export type DurableSseRecord = z.infer<typeof DurableSseRecordSchema>;

const INTERNAL_EVENT_NAMES: Partial<Record<DurableOutboxEventType, DurableSseEventType>> = {
  'execution.run.created': 'run.queued',
  'execution.run.cancelled': 'run.phase_changed',
  'execution.job.completed': 'run.completed',
  'run:updated': 'run.phase_changed',
  'run.updated': 'run.phase_changed',
};

export function toDurableSseEventName(
  eventType: string,
  payload: Record<string, unknown> = {},
): DurableSseEventType {
  const direct = RunEventTypeSchema.safeParse(eventType);
  if (direct.success) return direct.data;
  if (eventType === 'execution.event.appended') {
    const nested = RunEventTypeSchema.safeParse(payload['type']);
    if (nested.success) return nested.data;
  }
  const parsed = DurableOutboxEventTypeSchema.safeParse(eventType);
  if (parsed.success) return INTERNAL_EVENT_NAMES[parsed.data] ?? DURABLE_SSE_COMPATIBILITY_EVENT;
  return DURABLE_SSE_COMPATIBILITY_EVENT;
}

export interface DurableSseFrame {
  event: DurableSseEventType;
  data: Record<string, unknown>;
}

export function toDurableSseFrame(record: DurableSseRecord): DurableSseFrame {
  const event = toDurableSseEventName(record.eventType, record.payload);
  const nested = record.eventType === 'execution.event.appended' ? record.payload : undefined;
  const runId = typeof record.payload['runId'] === 'string' ? record.payload['runId'] : '';
  const type = event === DURABLE_SSE_COMPATIBILITY_EVENT ? 'run.phase_changed' : event;
  const nestedPayload = nested?.['payload'];
  const eventPayload =
    nestedPayload && typeof nestedPayload === 'object' && !Array.isArray(nestedPayload)
      ? (nestedPayload as Record<string, unknown>)
      : record.payload;
  const eventId =
    typeof nested?.['eventId'] === 'string' ? nested['eventId'] : record.eventId;
  const sequence =
    typeof nested?.['sequence'] === 'number' ? nested['sequence'] : record.sequence;
  const occurredAt =
    typeof nested?.['occurredAt'] === 'string'
      ? nested['occurredAt']
      : record.occurredAt.toISOString();
  return {
    event,
    data: {
      version: 1,
      type,
      eventId,
      sequence,
      occurredAt,
      runId,
      payload: eventPayload,
    },
  };
}
