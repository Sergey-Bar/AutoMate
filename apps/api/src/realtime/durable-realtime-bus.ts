import type { AppendOutboxEvent, OutboxEvent } from '@automate/db';
import type { RealtimeBus, RealtimeBusEvent, RunUpdatedPayload } from './realtime-bus.js';
import { sanitizeOutboxNested } from '../infrastructure/outbox-sanitizer.js';

export interface DurableRealtimeWriter {
  append(event: AppendOutboxEvent): Promise<OutboxEvent | null>;
}

function sanitizeEvent(event: RealtimeBusEvent): RealtimeBusEvent {
  if (event.type === 'run:updated') {
    return {
      type: 'run:updated',
      version: event.version,
      runId: event.runId,
      status: event.status,
      timestamp: event.timestamp,
    };
  }
  // A realtime event payload is domain data, not an outbox envelope, so it is
  // sanitized as nested: credential key names dropped, values scanned.
  return { ...event, payload: sanitizeOutboxNested(event.payload) };
}

function dedupeKey(event: RealtimeBusEvent, workspaceId: string): string {
  if (event.type === 'run:updated') {
    return `realtime:${workspaceId}:run:updated:${event.runId}:${event.status}:${event.timestamp}`;
  }
  return `realtime:${workspaceId}:${event.type}:${event.eventId}`;
}

function toAppend(
  event: RealtimeBusEvent,
  workspaceId: string,
  retentionHours: number,
): AppendOutboxEvent {
  const occurredAt = new Date(event.type === 'run:updated' ? event.timestamp : event.occurredAt);
  return {
    workspaceId,
    aggregateType: 'run',
    aggregateId: event.runId,
    eventType: event.type,
    eventVersion: 1,
    payload: { ...event },
    dedupeKey: dedupeKey(event, workspaceId),
    occurredAt: Number.isNaN(occurredAt.getTime()) ? new Date() : occurredAt,
    expiresAt: new Date(Date.now() + retentionHours * 3_600_000),
  };
}

export class DurableRealtimeBus implements RealtimeBus {
  private readonly subscribers = new Set<(event: RealtimeBusEvent) => void>();

  constructor(
    private readonly feed: DurableRealtimeWriter,
    private readonly workspaceId: string,
    private readonly retentionHours = 24,
    private readonly maxAttempts = 3,
    private readonly retryDelayMs = 25,
  ) {}

  async publish(event: RealtimeBusEvent): Promise<void> {
    const sanitized = sanitizeEvent(event);
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        const row = await this.feed.append(
          toAppend(sanitized, this.workspaceId, this.retentionHours),
        );
        if (!row) return;
        for (const subscriber of this.subscribers) subscriber(sanitized);
        return;
      } catch (error) {
        lastError = error;
        if (attempt < this.maxAttempts) {
          await new Promise<void>((resolve) => setTimeout(resolve, this.retryDelayMs * attempt));
        }
      }
    }
    console.error('durable realtime publish failed', lastError);
    throw lastError instanceof Error ? lastError : new Error('Durable realtime publish failed');
  }

  subscribe(callback: (event: RunUpdatedPayload) => void): () => void;
  subscribe(callback: (event: RealtimeBusEvent) => void): () => void;
  subscribe(
    callback: ((event: RunUpdatedPayload) => void) | ((event: RealtimeBusEvent) => void),
  ): () => void {
    const subscriber = callback as (event: RealtimeBusEvent) => void;
    this.subscribers.add(subscriber);
    return () => {
      this.subscribers.delete(subscriber);
    };
  }
}
