import { Hono } from 'hono';
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
    if (requestedCursor === undefined) return c.json({ error: 'Invalid cursor' }, 400);
    if (options.feed && !options.workspaceId) {
      return c.json({ error: 'Realtime workspace is not configured' }, 500);
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

      const unsubscribe = options.bus.subscribe((payload) => {
        void stream.writeSSE({
          event: 'message',
          data: JSON.stringify(payload),
        });
      });

      await new Promise<void>((resolve) => {
        stream.onAbort(resolve);
      });

      unsubscribe();
    });
  });

  return app;
}
