import type { AppendOutboxEvent, OutboxEvent } from '@automate/db';
import type { RealtimeBus, RealtimeBusEvent, RunUpdatedPayload } from './realtime-bus.js';

export interface DurableRealtimeWriter {
  append(event: AppendOutboxEvent): Promise<OutboxEvent | null>;
}

const SENSITIVE_KEY =
  /token|secret|password|credential|api[-_]?key|authorization|cookie|bearer|private/i;
const MAX_DEPTH = 5;
const MAX_ITEMS = 100;
const MAX_TEXT_LENGTH = 1024;

function sanitizeValue(value: unknown, depth: number): unknown {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string')
    return value.length > MAX_TEXT_LENGTH ? value.slice(0, MAX_TEXT_LENGTH) : value;
  if (depth >= MAX_DEPTH) return null;
  if (Array.isArray(value))
    return value.slice(0, MAX_ITEMS).map((item) => sanitizeValue(item, depth + 1));
  if (typeof value === 'object') return sanitizeRecord(value as Record<string, unknown>, depth + 1);
  return null;
}

function sanitizeRecord(value: Record<string, unknown>, depth: number): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (SENSITIVE_KEY.test(key)) continue;
    sanitized[key] = sanitizeValue(item, depth);
  }
  return sanitized;
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
  return { ...event, payload: sanitizeRecord(event.payload, 0) };
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
