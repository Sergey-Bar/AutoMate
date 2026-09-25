import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { InMemoryRealtimeBus } from '../realtime/realtime-bus.js';
import type {
  RealtimeBus,
  RealtimeBusEvent,
  RunUpdatedPayload,
} from '../realtime/realtime-bus.js';
import {
  createEventsRoutes,
  type DurableRealtimeFeed,
  type EventsRouteOptions,
} from './events.js';

class TrackingBus implements RealtimeBus {
  unsubscribeCalls = 0;

  publish(_event: RealtimeBusEvent): void {}

  subscribe(callback: (event: RunUpdatedPayload) => void): () => void;
  subscribe(callback: (event: RealtimeBusEvent) => void): () => void;
  subscribe(
    _callback: ((event: RunUpdatedPayload) => void) | ((event: RealtimeBusEvent) => void),
  ): () => void {
    return () => {
      this.unsubscribeCalls += 1;
    };
  }
}

function createApp(options: Partial<EventsRouteOptions> = {}) {
  const app = new Hono();
  app.route(
    '/',
    createEventsRoutes({
      ...options,
      bus: options.bus ?? new InMemoryRealtimeBus(),
    }),
  );
  return app;
}

async function read(reader: ReadableStreamDefaultReader<Uint8Array>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('SSE read timed out')), 1000);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const emptyFeed: DurableRealtimeFeed = {
  getRetentionFloor: async () => null,
  readAfter: async () => [],
};

describe('GET /api/v1/events', () => {
  it('rejects invalid event cursors', async () => {
    const app = createApp({ feed: emptyFeed, workspaceId: 'workspace-a' });

    const queryResponse = await app.request('/api/v1/events?cursor=not-a-number');
    const headerResponse = await app.request('/api/v1/events', {
      headers: { 'Last-Event-ID': '-1' },
    });

    expect(queryResponse.status).toBe(400);
    expect(headerResponse.status).toBe(400);
  });

  it('unsubscribes from the legacy bus when the client disconnects', async () => {
    const bus = new TrackingBus();
    const app = createApp({ bus });

    const response = await app.request('/api/v1/events');
    await response.body!.cancel();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(bus.unsubscribeCalls).toBe(1);
  });

  it('replays rows after Last-Event-ID before waiting for live rows', async () => {
    let requestedPage:
      | { workspaceId: string; afterSequence: number; limit?: number }
      | undefined;
    const feed: DurableRealtimeFeed = {
      getRetentionFloor: async () => 2,
      readAfter: async (page) => {
        requestedPage = page;
        return [
          {
            sequence: 2,
            eventType: 'run.updated',
            payload: { runId: 'run-1', status: 'running' },
          },
        ];
      },
    };
    const app = createApp({ feed, workspaceId: 'workspace-a', pollIntervalMs: 60_000 });

    const response = await app.request('/api/v1/events', {
      headers: { 'Last-Event-ID': '1' },
    });
    const reader = response.body!.getReader();

    try {
      const chunk = await read(reader);
      const frame = new TextDecoder().decode(chunk.value);

      expect(frame).toContain('event: run.phase_changed');
      expect(frame).toContain('id: 2');
      expect(frame).toContain('"type":"run.phase_changed"');
      expect(frame).toContain('"runId":"run-1"');
      expect(requestedPage).toEqual({
        workspaceId: 'workspace-a',
        afterSequence: 1,
        limit: 100,
      });
    } finally {
      await reader.cancel();
    }
  });

  it('emits refetch before replay when the requested cursor predates retention', async () => {
    const feed: DurableRealtimeFeed = {
      getRetentionFloor: async () => 4,
      readAfter: async () => [
        {
          sequence: 4,
          eventType: 'run.updated',
          payload: { runId: 'run-1', status: 'running' },
        },
      ],
    };
    const app = createApp({ feed, workspaceId: 'workspace-a', pollIntervalMs: 60_000 });

    const response = await app.request('/api/v1/events?cursor=1');
    const reader = response.body!.getReader();

    try {
      let frame = '';
      while (!frame.includes('event: run.phase_changed')) {
        frame += new TextDecoder().decode((await read(reader)).value);
      }

      expect(frame).toContain('event: refetch');
      expect(frame).toContain('id: 3');
      expect(frame).toContain(
        'data: {"reason":"cursor_gap","requestedCursor":1,"resumeCursor":3}',
      );
      expect(frame.indexOf('event: refetch')).toBeLessThan(frame.indexOf('event: run.phase_changed'));
    } finally {
      await reader.cancel();
    }
  });

  it('polls committed rows after the query cursor replay', async () => {
    const pages = [
      [
        {
          sequence: 3,
          eventType: 'run.updated',
          payload: { runId: 'run-1', status: 'running' },
        },
      ],
      [
        {
          sequence: 4,
          eventType: 'run.completed',
          payload: { runId: 'run-1', status: 'passed' },
        },
      ],
      [],
    ];
    const requestedCursors: number[] = [];
    const feed: DurableRealtimeFeed = {
      getRetentionFloor: async () => 3,
      readAfter: async ({ afterSequence }) => {
        requestedCursors.push(afterSequence);
        return pages[Math.min(requestedCursors.length - 1, pages.length - 1)]!;
      },
    };
    const app = createApp({ feed, workspaceId: 'workspace-a', pollIntervalMs: 1 });

    const response = await app.request('/api/v1/events?cursor=2');
    const reader = response.body!.getReader();

    try {
      const replay = new TextDecoder().decode((await read(reader)).value);
      const live = new TextDecoder().decode((await read(reader)).value);

      expect(replay).toContain('id: 3');
      expect(live).toContain('event: run.completed');
      expect(live).toContain('id: 4');
      expect(requestedCursors.slice(0, 2)).toEqual([2, 3]);
    } finally {
      await reader.cancel();
    }
  });
});
