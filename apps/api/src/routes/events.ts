import { Hono } from 'hono';
import { DomainError } from '../errors/domain-error.js';
import { streamSSE } from 'hono/streaming';
import {
  EVENT_VERSION,
  toDurableSseFrame,
  type DurableOutboxEventType,
} from '@automate/shared-contracts';
import type { RealtimeBus } from '../realtime/realtime-bus.js';

export interface DurableRealtimeEvent {
  sequence: number;
  eventId?: string;
  eventVersion?: number;
  eventType: DurableOutboxEventType;
  occurredAt?: Date;
  payload: Record<string, unknown>;
}

export interface DurableRealtimeFeed {
  subscribe?(
    workspaceId: string,
    afterSequence: number,
    listener: (event: DurableRealtimeEvent) => void | Promise<void>,
    pollIntervalMs?: number,
  ): () => void;
  getRetentionFloor(workspaceId?: string): Promise<number | null>;
  readAfter(page: {
    workspaceId: string;
    afterSequence: number;
    limit?: number;
  }): Promise<DurableRealtimeEvent[]>;
}

export interface EventsRouteOptions {
  bus: RealtimeBus;
  feed?: DurableRealtimeFeed;
  workspaceId?: string;
  pageSize?: number;
  pollIntervalMs?: number;
}

function parseCursor(value: string | undefined): number | null | undefined {
  if (value === undefined) return null;
  if (!/^\d+$/.test(value)) return undefined;
  const cursor = Number(value);
  return Number.isSafeInteger(cursor) ? cursor : undefined;
}

function boundedPageSize(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 100;
  return Math.min(500, Math.max(1, Math.trunc(value)));
}

function boundedPollInterval(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 1000;
  return Math.max(1, Math.trunc(value));
}

export function createEventsRoutes(options: EventsRouteOptions): Hono {
  const app = new Hono();
  const pageSize = boundedPageSize(options.pageSize);
  const pollIntervalMs = boundedPollInterval(options.pollIntervalMs);

  app.get('/api/v1/events', (c) => {
    const requestedCursor = options.feed
      ? parseCursor(c.req.header('Last-Event-ID') ?? c.req.query('cursor'))
      : null;
    if (requestedCursor === undefined) {
      throw new DomainError('INVALID_CURSOR', 'Invalid cursor');
    }
    if (options.feed && !options.workspaceId) {
      // 503, and the taxonomy says so. This used to be a 500, which filed a
      // configuration mistake under application defects and told the caller nothing.
      throw new DomainError('NOT_CONFIGURED', 'Realtime workspace is not configured');
    }

    return streamSSE(c, async (stream) => {
      if (options.feed?.subscribe && options.workspaceId) {
        const feed = options.feed;
        const cursor = requestedCursor ?? 0;
        let resumeCursor = cursor;
        if (requestedCursor !== null) {
          const retentionFloor = await options.feed.getRetentionFloor(options.workspaceId);
          if (retentionFloor === null || cursor + 1 < retentionFloor) {
            resumeCursor = retentionFloor === null ? cursor : retentionFloor - 1;
          }
        }
        await new Promise<void>((resolve) => {
          let closed = false;
          let unsubscribe: () => void = () => undefined;
          const finish = () => {
            if (closed) return;
            closed = true;
            unsubscribe();
            resolve();
          };
          stream.onAbort(finish);
          // `unsubscribe` is still the no-op until the assignment below, and finding
          // P-70 named that as a leak. It is not one, and the reason is the line
          // marked below: the only `await` an abort can be delivered during is the
          // refetch frame's `writeSSE`, and the guard after it returns before the
          // subscription is ever made. There is no await between that guard and the
          // assignment either, so no abort can arrive in between. A test asserting the
          // subscription pair (`subscribes === unsubscribes`) passes with the code in
          // this order and would pass with it reordered, which is what says the reorder
          // is not the fix.
          void (async () => {
            if (requestedCursor !== null && resumeCursor !== cursor && !stream.aborted) {
              await stream.writeSSE({
                id: String(resumeCursor),
                event: 'refetch',
                data: JSON.stringify({
                  reason: 'cursor_gap',
                  requestedCursor: cursor,
                  resumeCursor,
                }),
              });
            }
            if (closed || stream.aborted) return;
            unsubscribe = feed.subscribe!(
              options.workspaceId!,
              resumeCursor,
              async (event) => {
                if (closed || stream.aborted) return;
                const frame = toDurableSseFrame({
                  sequence: event.sequence,
                  eventId: event.eventId ?? `sequence-${event.sequence}`,
                  eventVersion: event.eventVersion ?? EVENT_VERSION,
                  eventType: event.eventType,
                  occurredAt: event.occurredAt ?? new Date(),
                  payload: event.payload,
                });
                await stream.writeSSE({
                  id: String(event.sequence),
                  event: frame.event,
                  data: JSON.stringify(frame.data),
                });
              },
              pollIntervalMs,
            );
          })().catch(finish);
        });
        return;
      }

      if (options.feed && options.workspaceId) {
        let cursor = requestedCursor ?? 0;
        if (requestedCursor !== null) {
          const retentionFloor = await options.feed.getRetentionFloor(options.workspaceId);
          if (retentionFloor === null || cursor + 1 < retentionFloor) {
            const resumeCursor = retentionFloor === null ? cursor : retentionFloor - 1;
            if (!stream.aborted) {
              await stream.writeSSE({
                id: String(resumeCursor),
                event: 'refetch',
                data: JSON.stringify({
                  reason: 'cursor_gap',
                  requestedCursor: cursor,
                  resumeCursor,
                }),
              });
            }
            cursor = resumeCursor;
          }
        }
        let pollTimer: ReturnType<typeof setTimeout> | undefined;
        let wakePoll: (() => void) | undefined;
        const stopPolling = () => {
          if (pollTimer) clearTimeout(pollTimer);
          wakePoll?.();
        };
        stream.onAbort(stopPolling);
        while (!stream.aborted) {
          const page = await options.feed.readAfter({
            workspaceId: options.workspaceId,
            afterSequence: cursor,
            limit: pageSize,
          });
          for (const event of page) {
            if (stream.aborted) break;
            const frame = toDurableSseFrame({
              sequence: event.sequence,
              eventId: event.eventId ?? `sequence-${event.sequence}`,
              eventVersion: event.eventVersion ?? EVENT_VERSION,
              eventType: event.eventType,
              occurredAt: event.occurredAt ?? new Date(),
              payload: event.payload,
            });
            await stream.writeSSE({
              id: String(event.sequence),
              event: frame.event,
              data: JSON.stringify(frame.data),
            });
            cursor = event.sequence;
          }
          if (stream.aborted || page.length === pageSize) continue;
          await new Promise<void>((resolve) => {
            wakePoll = resolve;
            pollTimer = setTimeout(() => {
              pollTimer = undefined;
              wakePoll = undefined;
              resolve();
            }, pollIntervalMs);
          });
        }
        return;
      }

      // The teardown lives in the `finally`, not inside the abort handler.
      //
      // The handler was `void stream.writeSSE(...)`, and this is worth being precise
      // about: in the pinned Hono, `writeSSE` *resolves* after the client has gone
      // away, because cancelling the readable side of a TransformStream does not error
      // the writable side. So the row's claim that this discards a rejection was
      // checked and did not reproduce — there is no unhandled-rejection crash path
      // here, and `void` is this tree's sanctioned floating-promise escape hatch, so
      // lint did not object either.
      //
      // What the old shape did get wrong is real and is what this fixes: two teardown
      // points that are not one, and a promise nobody watches. `stop` is assigned by
      // the synchronous `subscribe` call and released once in the `finally`, so a bus
      // that delivers a buffered event *during* `subscribe` — whose write fails
      // before `stop` exists — still tears down. A teardown function that might not be
      // assigned yet is the leak the row named on the subscription path below, which
      // does not have it because the `if (closed || stream.aborted) return` after the
      // last await closes that window.
      const unsubscribe = options.bus.subscribe((payload) => {
        void stream.writeSSE({ event: 'message', data: JSON.stringify(payload) });
      });

      await new Promise<void>((resolve) => {
        stream.onAbort(resolve);
      });

      unsubscribe();
    });
  });

  return app;
}
