import { describe, expect, it } from 'vitest';
import {
  DURABLE_SSE_COMPATIBILITY_EVENT,
  DurableSseRecordSchema,
  toDurableSseEventName,
  toDurableSseFrame,
} from './durable-realtime.js';

describe('durable realtime contract', () => {
  it('accepts a canonical event name directly', () => {
    expect(toDurableSseEventName('run.started')).toBe('run.started');
  });

  it('maps internal outbox events to the shared canonical SSE names', () => {
    expect(toDurableSseEventName('execution.run.created')).toBe('run.queued');
    expect(toDurableSseEventName('execution.run.cancelled')).toBe('run.phase_changed');
    expect(toDurableSseEventName('execution.job.completed')).toBe('run.completed');
    expect(toDurableSseEventName('run:updated')).toBe('run.phase_changed');
  });

  it('uses the nested canonical type for appended execution events', () => {
    expect(toDurableSseEventName('execution.event.appended', { type: 'test.completed' })).toBe(
      'test.completed',
    );
    expect(toDurableSseEventName('execution.event.appended', { type: 'unknown.event' })).toBe(
      DURABLE_SSE_COMPATIBILITY_EVENT,
    );
  });

  it('falls back to the compatibility event for unknown producers', () => {
    expect(toDurableSseEventName('future.event')).toBe(DURABLE_SSE_COMPATIBILITY_EVENT);
    expect(toDurableSseEventName('')).toBe(DURABLE_SSE_COMPATIBILITY_EVENT);
  });

  it('builds a compatibility frame when nested appended fields are unusable', () => {
    const frame = toDurableSseFrame({
      sequence: 10,
      eventId: 'outbox-10',
      eventVersion: 1,
      eventType: 'execution.event.appended',
      occurredAt: new Date('2026-01-01T00:00:00.000Z'),
      payload: {
        eventId: 12,
        sequence: 'bad',
        occurredAt: 12,
        payload: ['not', 'an', 'object'],
      },
    });
    expect(frame.event).toBe(DURABLE_SSE_COMPATIBILITY_EVENT);
    expect(frame.data.type).toBe('run.phase_changed');
    expect(frame.data.eventId).toBe('outbox-10');
    expect(frame.data.sequence).toBe(10);
  });

  it('falls back to a canonical envelope for an unknown producer', () => {
    const frame = toDurableSseFrame({
      sequence: 11,
      eventId: 'outbox-11',
      eventVersion: 1,
      eventType: 'future.internal',
      occurredAt: new Date('2026-01-01T00:00:00.000Z'),
      payload: { runId: 'run-3' },
    });
    expect(frame.event).toBe(DURABLE_SSE_COMPATIBILITY_EVENT);
    expect(frame.data.runId).toBe('run-3');
  });

  it('builds a canonical envelope for appended execution events', () => {
    const frame = toDurableSseFrame({
      sequence: 9,
      eventId: 'outbox-9',
      eventVersion: 1,
      eventType: 'execution.event.appended',
      occurredAt: new Date('2026-01-01T00:00:00.000Z'),
      payload: {
        runId: 'run-1',
        eventId: 'event-9',
        sequence: 4,
        occurredAt: '2026-01-01T00:00:00.000Z',
        type: 'test.completed',
        payload: { status: 'passed' },
      },
    });
    expect(frame.event).toBe('test.completed');
    expect(frame.data).toMatchObject({
      type: 'test.completed',
      eventId: 'event-9',
      sequence: 4,
      runId: 'run-1',
      payload: { status: 'passed' },
    });
  });

  it('uses the outbox fields for a non-appended event', () => {
    const frame = toDurableSseFrame({
      sequence: 12,
      eventId: 'outbox-12',
      eventVersion: 1,
      eventType: 'run.queued',
      occurredAt: new Date('2026-01-01T00:00:00.000Z'),
      payload: { runId: 'run-4', status: 'queued' },
    });
    expect(frame.event).toBe('run.queued');
    expect(frame.data.payload).toEqual({ runId: 'run-4', status: 'queued' });
  });

  it('validates the durable SSE record envelope', () => {
    expect(
      DurableSseRecordSchema.parse({
        sequence: 4,
        eventId: 'event-4',
        eventVersion: 1,
        eventType: 'execution.event.appended',
        occurredAt: '2026-01-01T00:00:00.000Z',
        payload: { runId: 'run-1' },
      }).sequence,
    ).toBe(4);
  });
});
