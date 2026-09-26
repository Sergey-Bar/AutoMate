import type { AppendOutboxEvent, OutboxEvent } from '@automate/db';
import { EVENT_VERSION } from '@automate/shared-contracts';
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
    eventVersion: EVENT_VERSION,
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

  /**
   * Notifies every in-process subscriber, one at a time and in isolation.
   *
   * The previous loop was `for (const s of this.subscribers) s(sanitized)`, so a
   * subscriber that threw aborted the notification for every subscriber after
   * it — they silently missed the event with nothing logged. Extracted rather
   * than inlined so the isolation is one named thing instead of a `try` nested
   * inside a retry loop, which is what pushed this function's complexity over the
   * ratchet's ceiling.
   */
  private async notifySubscribers(event: RealtimeBusEvent): Promise<void> {
    for (const subscriber of this.subscribers) {
      try {
        // Awaited, so a rejection is caught here rather than escaping as an
        // unhandled rejection.
        await subscriber(event);
      } catch (error) {
        console.error('realtime subscriber failed', {
          type: event.type,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  /**
   * Appends an event to the durable outbox and notifies in-process subscribers.
   *
   * **Never rejects.** Publishing is a *reporting* concern, and it is called
   * from the middle of request handling and store transactions. Rethrowing after
   * the retry budget is spent let a failing outbox fail the write it was
   * reporting on — a monitoring path taking down the service it observes, which
   * is the same reasoning that keeps a bad Sentry sample rate from refusing to
   * start the API.
   *
   * After the budget is spent the failure is logged and swallowed. The event is
   * not delivered live, and the log is the only record: a durable append that
   * failed is a real gap, but it is not the caller's error to carry.
   */
  async publish(event: RealtimeBusEvent): Promise<void> {
    const sanitized = sanitizeEvent(event);
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        const row = await this.feed.append(
          toAppend(sanitized, this.workspaceId, this.retentionHours),
        );
        if (!row) return;
        await this.notifySubscribers(sanitized);
        return;
      } catch (error) {
        lastError = error;
        if (attempt < this.maxAttempts) {
          await new Promise<void>((resolve) => setTimeout(resolve, this.retryDelayMs * attempt));
        }
      }
    }
    console.error('durable realtime publish failed', lastError);
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
