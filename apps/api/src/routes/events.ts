/**
 * events.ts — GET /api/v1/events SSE route
 *
 * Subscribes to the RealtimeBus and forwards run:updated events as
 * Server-Sent Events to connected clients.
 *
 * Each SSE event is emitted with:
 *   event: run:updated
 *   data:  <JSON-serialised RunUpdatedPayload>
 *
 * The stream stays open until the client disconnects (abort signal fires).
 * The bus subscription is cleaned up on disconnect.
 */
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { RealtimeBus } from '../realtime/realtime-bus.js';

// ---------------------------------------------------------------------------
// Route factory options
// ---------------------------------------------------------------------------

export interface EventsRouteOptions {
  /**
   * Realtime bus — must be the same instance wired into the reporter routes
   * so that events published during ingestion reach this SSE stream.
   */
  bus: RealtimeBus;
}

// ---------------------------------------------------------------------------
// Route factory
// ---------------------------------------------------------------------------

/**
 * Creates the SSE events Hono app.
 *
 * @param options  Route configuration, including the realtime bus.
 */
export function createEventsRoutes(options: EventsRouteOptions): Hono {
  const app = new Hono();

  // ------------------------------------------------------------------
  // GET /api/v1/events — SSE stream (versioned canonical path)
  // ------------------------------------------------------------------
  app.get('/api/v1/events', (c) => {
    return streamSSE(c, async (stream) => {
      const unsubscribe = options.bus.subscribe((payload) => {
        void stream.writeSSE({
          event: 'run:updated',
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
