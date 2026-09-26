import {
  DrizzleOutboxRepository,
  type AppendOutboxEvent,
  type OutboxDatabase,
  type OutboxEvent,
  type OutboxReadPage,
} from '@automate/db';

type FeedListener = (event: OutboxEvent) => void | Promise<void>;

interface FeedSubscription {
  cursor: number;
  listener: FeedListener;
}

interface FeedPump {
  cursor: number;
  intervalMs: number;
  timer: ReturnType<typeof setInterval> | null;
  running: boolean;
  subscriptions: Set<FeedSubscription>;
}

export class DrizzleRealtimeFeed {
  private readonly outbox: DrizzleOutboxRepository;
  private readonly pumps = new Map<string, FeedPump>();

  constructor(db: OutboxDatabase) {
    this.outbox = new DrizzleOutboxRepository(db);
  }

  append(event: AppendOutboxEvent) {
    return this.outbox.append(event);
  }

  appendMany(events: AppendOutboxEvent[]) {
    return this.outbox.appendMany(events);
  }

  readAfter(page: OutboxReadPage) {
    return this.outbox.readAfter(page);
  }

  getRetentionFloor(workspaceId?: string) {
    return this.outbox.getRetentionFloor(workspaceId);
  }

  purgeExpired(now?: Date) {
    return this.outbox.purgeExpired(now);
  }

  subscribe(
    workspaceId: string,
    afterSequence: number,
    listener: FeedListener,
    pollIntervalMs = 1000,
  ): () => void {
    const pump = this.pumps.get(workspaceId) ?? {
      cursor: afterSequence,
      intervalMs: pollIntervalMs,
      timer: null,
      running: false,
      subscriptions: new Set<FeedSubscription>(),
    };
    const subscription: FeedSubscription = { cursor: afterSequence, listener };
    pump.subscriptions.add(subscription);
    pump.cursor = Math.min(pump.cursor, afterSequence);
    if (!pump.timer) {
      pump.timer = setInterval(() => void this.pump(workspaceId, pump), pump.intervalMs);
      pump.timer.unref?.();
    }
    this.pumps.set(workspaceId, pump);
    void this.pump(workspaceId, pump);
    return () => {
      pump.subscriptions.delete(subscription);
      this.recomputeCursor(pump);
      if (pump.subscriptions.size === 0 && pump.timer) {
        clearInterval(pump.timer);
        pump.timer = null;
        this.pumps.delete(workspaceId);
      }
    };
  }

  private recomputeCursor(pump: FeedPump): void {
    if (pump.subscriptions.size === 0) return;
    pump.cursor = Math.min(...[...pump.subscriptions].map((subscription) => subscription.cursor));
  }

  /**
   * Delivers one event to every subscription, in isolation.
   *
   * Extracted from the page loop so the isolation is one named thing: inlined,
   * the `try` sat inside a nested `for`, and adding it pushed this function over
   * the complexity ratchet's ceiling for no gain.
   *
   * A subscription's cursor advances **only after** its listener resolves. It
   * used to advance before the call, so a listener that threw — an SSE write to a
   * client that had already gone away — advanced past an event that was
   * therefore never delivered and never delivered again. The loss was silent.
   */
  private async deliver(
    subscriptions: Iterable<FeedSubscription>,
    event: OutboxEvent,
    workspaceId: string,
  ): Promise<void> {
    for (const subscription of subscriptions) {
      if (event.sequence <= subscription.cursor) continue;
      let delivered = false;
      try {
        // Awaited, not called bare: a listener may be async, and a rejection has
        // to be caught *here* for the cursor to stay put. Calling it bare would
        // advance the cursor before the listener finished — which is the exact
        // bug this method exists to prevent.
        await subscription.listener(event);
        delivered = true;
      } catch (error) {
        console.error('outbox subscription failed; event will be retried', {
          workspaceId,
          sequence: event.sequence,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      if (delivered) subscription.cursor = event.sequence;
    }
  }

  private async pump(workspaceId: string, pump: FeedPump): Promise<void> {
    if (pump.running || pump.subscriptions.size === 0) return;
    pump.running = true;
    try {
      this.recomputeCursor(pump);
      const page = await this.outbox.readAfter({
        workspaceId,
        afterSequence: pump.cursor,
        limit: 100,
      });
      for (const event of page) {
        await this.deliver(pump.subscriptions, event, workspaceId);
      }
    } catch (error) {
      // The previous `catch { return; }` discarded the error, so an outbox that
      // had started failing looked exactly like one with nothing to say.
      console.error('outbox pump failed', {
        workspaceId,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      pump.running = false;
    }
  }
}
