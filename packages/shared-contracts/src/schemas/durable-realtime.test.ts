import { describe, expect, it } from 'vitest';
import {
  DURABLE_OUTBOX_EVENT_TYPES,
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
        runId: 'run-10',
        eventId: 12,
        sequence: 'bad',
        occurredAt: 12,
        payload: ['not', 'an', 'object'],
      },
    });
    expect(frame.event).toBe(DURABLE_SSE_COMPATIBILITY_EVENT);
    // The real type is reported, not rewritten to `run.phase_changed`. A
    // consumer must be able to tell an unusable event from a real phase change.
    expect(frame.data.type).toBe('execution.event.appended');
    expect(frame.data.eventId).toBe('outbox-10');
    expect(frame.data.sequence).toBe(10);
  });

  it('refuses to build a record with no run id', () => {
    // A frame with `runId: ''` is indistinguishable from a real run whose id is
    // empty, and breaks every run-scoped reducer on the client.
    expect(
      DurableSseRecordSchema.safeParse({
        sequence: 1,
        eventId: 'outbox-1',
        eventVersion: 1,
        eventType: 'run.queued',
        occurredAt: new Date('2026-01-01T00:00:00.000Z'),
        payload: { type: 'run.queued' },
      }).success,
    ).toBe(false);
    expect(
      DurableSseRecordSchema.safeParse({
        sequence: 1,
        eventId: 'outbox-1',
        eventVersion: 1,
        eventType: 'run.queued',
        occurredAt: new Date('2026-01-01T00:00:00.000Z'),
        payload: { runId: '' },
      }).success,
    ).toBe(false);
    expect(
      DurableSseRecordSchema.safeParse({
        sequence: 1,
        eventId: 'outbox-1',
        eventVersion: 1,
        eventType: 'run.queued',
        occurredAt: new Date('2026-01-01T00:00:00.000Z'),
        payload: { runId: 'run-1' },
      }).success,
    ).toBe(true);
  });

  it('reports the nested type of an appended event, not the wrapper', () => {
    const frame = toDurableSseFrame({
      sequence: 12,
      eventId: 'outbox-12',
      eventVersion: 1,
      eventType: 'execution.event.appended',
      occurredAt: new Date('2026-01-01T00:00:00.000Z'),
      payload: { runId: 'run-12', type: 'test.completed' },
    });
    // The nested type is canonical, so the frame event is the nested name and
    // the reported type agrees with it.
    expect(frame.event).toBe('test.completed');
    expect(frame.data.type).toBe('test.completed');
  });

  it('falls back through an unusable nested type to the real event type', () => {
    for (const nestedType of [undefined, 42, '']) {
      const frame = toDurableSseFrame({
        sequence: 13,
        eventId: 'outbox-13',
        eventVersion: 1,
        eventType: 'execution.event.appended',
        occurredAt: new Date('2026-01-01T00:00:00.000Z'),
        payload: { runId: 'run-13', ...(nestedType === undefined ? {} : { type: nestedType }) },
      });
      expect(frame.event).toBe(DURABLE_SSE_COMPATIBILITY_EVENT);
      expect(frame.data.type).toBe('execution.event.appended');
    }
  });

  it('reports a non-canonical nested type verbatim rather than as a phase change', () => {
    const frame = toDurableSseFrame({
      sequence: 13,
      eventId: 'outbox-13b',
      eventVersion: 1,
      eventType: 'execution.event.appended',
      occurredAt: new Date('2026-01-01T00:00:00.000Z'),
      payload: { runId: 'run-13', type: 'some.future.event' },
    });
    // The frame event is the compatibility marker, but the reported type is
    // what the producer actually said. Rewriting it would make an unknown
    // event indistinguishable from a real phase change.
    expect(frame.event).toBe(DURABLE_SSE_COMPATIBILITY_EVENT);
    expect(frame.data.type).toBe('some.future.event');
  });

  it('reports the wrapper type for an internal event with no nested type', () => {
    const frame = toDurableSseFrame({
      sequence: 14,
      eventId: 'outbox-14',
      eventVersion: 1,
      eventType: 'future.internal',
      occurredAt: new Date('2026-01-01T00:00:00.000Z'),
      payload: { runId: 'run-14', nested: { nested: true } },
    });
    expect(frame.event).toBe(DURABLE_SSE_COMPATIBILITY_EVENT);
    expect(frame.data.type).toBe('future.internal');
  });

  it('carries the run id through to the frame', () => {
    const frame = toDurableSseFrame({
      sequence: 15,
      eventId: 'outbox-15',
      eventVersion: 1,
      eventType: 'run.queued',
      occurredAt: new Date('2026-01-01T00:00:00.000Z'),
      payload: { runId: 'run-15', type: 'run.queued' },
    });
    expect(frame.data.runId).toBe('run-15');
  });

  it('does not treat run.updated and run:updated as two different events', () => {
    // The outbox list carried both spellings, so a producer could pick either
    // and consumers had to handle two names for one event.
    expect(DURABLE_OUTBOX_EVENT_TYPES).toContain('run:updated');
    expect(DURABLE_OUTBOX_EVENT_TYPES).not.toContain('run.updated');
    const duplicates = DURABLE_OUTBOX_EVENT_TYPES.filter(
      (type, index, all) => all.indexOf(type) !== index,
    );
    expect(duplicates).toEqual([]);
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
