/**
 * realtime-bus.ts — Realtime broadcast seam for run update events (T15)
 *
 * Defines the RealtimeBus publication interface and a test-only
 * InMemoryRealtimeBus implementation.
 *
 * RunUpdatedPayload mirrors the flat RunUpdatedEventSchema in
 * packages/realtime/src/events.ts — a
 *   { type, version, runId, status, timestamp } shape. The `type` is
 *   `typeof RUN_UPDATED_EVENT_TYPE`, the contract's own constant, so this
 *   interface cannot drift from the event a reader matches on: it was written as a
 *   bare string here and the two were only ever agreeing by hand.
 *
 * Only fields from that schema are included in the broadcast;
 * user-supplied payload data (which may contain secrets or credentials)
 * is never forwarded.
 */

// ---------------------------------------------------------------------------
// Event payload type (mirrors RunUpdatedEventSchema from @automate/realtime)
// ---------------------------------------------------------------------------

import { RUN_UPDATED_EVENT_TYPE, type RunEventType } from '@automate/shared-contracts';

export interface RunUpdatedPayload {
  type: typeof RUN_UPDATED_EVENT_TYPE;
  version: '1';
  runId: string;
  /** Current run status at the time of broadcast */
  status: string;
  /** ISO-8601 timestamp of the broadcast */
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Realtime bus interface
// ---------------------------------------------------------------------------

/**
 * RealtimeBus is the minimal publication seam for run update events.
 *
 * Production code will implement this over WebSocket / SSE.
 * Tests inject an InMemoryRealtimeBus for in-process verification.
 */
export interface CanonicalRealtimeEvent {
  // The contract's type, not a parallel ten-name union. The union was the third
  // hand-maintained copy of the same list, and adding an eleventh event name to
  // `RunEventTypeSchema` left it behind with nothing to fail.
  type: RunEventType;
  version: '1';
  eventId: string;
  sequence: number;
  occurredAt: string;
  runId: string;
  payload: Record<string, unknown>;
}

export type RealtimeBusEvent = RunUpdatedPayload | CanonicalRealtimeEvent;

export interface RealtimeBus {
  publish(event: RealtimeBusEvent): void | Promise<void>;
  subscribe(callback: (event: RunUpdatedPayload) => void): () => void;
  subscribe(callback: (event: RealtimeBusEvent) => void): () => void;
}

// ---------------------------------------------------------------------------
// In-memory implementation (test / development use only)
// ---------------------------------------------------------------------------

/**
 * InMemoryRealtimeBus collects published events in-order in `.published`.
 * Tests inspect this array to verify broadcast behaviour.
 *
 * NOT for production use.
 */
export class InMemoryRealtimeBus implements RealtimeBus {
  readonly published: RunUpdatedPayload[] = [];
  readonly canonicalPublished: CanonicalRealtimeEvent[] = [];
  private readonly _subscribers: Array<(event: RealtimeBusEvent) => void> = [];

  publish(event: RealtimeBusEvent): void {
    if (event.type === RUN_UPDATED_EVENT_TYPE) this.published.push(event);
    else this.canonicalPublished.push(event);
    for (const cb of this._subscribers) {
      cb(event);
    }
  }

  subscribe(callback: (event: RunUpdatedPayload) => void): () => void;
  subscribe(callback: (event: RealtimeBusEvent) => void): () => void;
  subscribe(
    callback: ((event: RunUpdatedPayload) => void) | ((event: RealtimeBusEvent) => void),
  ): () => void {
    const subscriber = (event: RealtimeBusEvent): void => {
      if (event.type === RUN_UPDATED_EVENT_TYPE)
        (callback as (value: RunUpdatedPayload) => void)(event);
      else (callback as (value: RealtimeBusEvent) => void)(event);
    };
    this._subscribers.push(subscriber);
    return () => {
      const idx = this._subscribers.indexOf(subscriber);
      if (idx !== -1) this._subscribers.splice(idx, 1);
    };
  }
}
